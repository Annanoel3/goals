import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();
const LOOKAHEAD_DAYS = 8;

async function getGoalUserEmail(base44, goal) {
  try {
    const u = await base44.asServiceRole.entities.User.get(goal.created_by_id);
    return u?.email || null;
  } catch (_) { return null; }
}

async function schedulePush({ externalId, title, body, data, buttons, sendAt }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [String(externalId)] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    data: data || {},
    ...(buttons ? { buttons } : {}),
    ...(sendAt ? { send_after: sendAt } : {}),
  };
  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json?.errors) console.error('[cronGoalNotifications] OneSignal errors:', JSON.stringify(json.errors));
    return json?.id || null;
  } catch (e) { console.error('[cronGoalNotifications] schedule failed:', e.message); return null; }
}

async function cancelPush(notifId) {
  try {
    await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE', headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch (_) {}
}

function localTimeToUTC(dateStr, hour, min, tz) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const totalUTCMins = (hour * 60 + min) - tz;
  d.setUTCHours(Math.floor(totalUTCMins / 60), totalUTCMins % 60, 0, 0);
  return d.toISOString();
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}
function utcDow(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); }
function parsePreferredTime(str) {
  let hour = 9, min = 0;
  const m = (str || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    hour = parseInt(m[1]); min = parseInt(m[2]);
    if (m[3]) { const pm = m[3].toUpperCase() === 'PM'; if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; }
  }
  return { hour, min };
}
function parsePhase(phase) {
  const m = (phase || '').match(/Month\s*(\d+)[,\s]+Week\s*(\d+)/i);
  return m ? { month: parseInt(m[1], 10), week: parseInt(m[2], 10) } : null;
}
function firstLine(s) { return (s || '').split('\n')[0].slice(0, 140); }
function stepForDate(sortedWeekSteps, dateStr) {
  let chosen = null;
  for (const s of sortedWeekSteps) {
    if (s.due_date <= dateStr) chosen = s; else break;
  }
  return chosen || sortedWeekSteps[0] || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const { goal_id, timezoneOffsetMinutes } = body;
    const sweep = !goal_id;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const horizon = addDays(todayStr, LOOKAHEAD_DAYS);
    const dow = utcDow(todayStr);
    const isMonday = dow === 1, isSunday = dow === 0;
    const isLastOfMonth = addDays(todayStr, 1).slice(8) === '01';

    let goals = [];
    if (goal_id) {
      const g = await base44.asServiceRole.entities.Goal.get(goal_id);
      if (g) goals = [g];
    } else {
      goals = await base44.asServiceRole.entities.Goal.filter({ status: 'active' });
    }

    let scheduled = 0, cancelled = 0, sent = 0;

    for (const goal of goals) {
      if (goal.status !== 'active') continue;
      const externalId = await getGoalUserEmail(base44, goal);
      if (!externalId) continue;

      let tz = typeof goal.timezone_offset_minutes === 'number' ? goal.timezone_offset_minutes
        : (typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0);
      if (typeof goal.timezone_offset_minutes !== 'number' && typeof timezoneOffsetMinutes === 'number') {
        try { await base44.asServiceRole.entities.Goal.update(goal.id, { timezone_offset_minutes: tz }); } catch (_) {}
      }

      const { hour, min } = parsePreferredTime(goal.preferred_time);
      const includeWeekends = goal.include_weekend_reminders !== false;
      const isDailyHabit = goal.requires_daily_action === true;

      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const weekSteps = steps.filter(s => s.due_date && parsePhase(s.phase))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
      const pending = steps.filter(s => s.status !== 'completed' && s.status !== 'skipped');

      const oldIds = goal.onesignal_notification_ids || [];
      await Promise.all(oldIds.map(cancelPush));
      cancelled += oldIds.length;
      const newIds = [];

      if (isDailyHabit) {
        for (let d = 0; d < 7; d++) {
          const dateStr = addDays(todayStr, d);
          const wd = utcDow(dateStr);
          if (!includeWeekends && (wd === 0 || wd === 6)) continue;
          const step = stepForDate(weekSteps, dateStr);
          if (!step || step.status === 'completed' || step.status === 'skipped') continue;
          const sendAt = localTimeToUTC(dateStr, hour, min, tz);
          if (new Date(sendAt) > now) {
            const id = await schedulePush({
              externalId,
              title: `${step.title} 📖`,
              body: `Time to: ${firstLine(step.description) || step.title}`,
              data: { screen: 'GoalDetail', action: 'daily_habit', goal_id: goal.id, step_id: step.id, date: dateStr },
              buttons: [{ id: 'complete', text: '✅ Done' }, { id: 'remind_later', text: '🔔 Remind Later' }],
              sendAt,
            });
            if (id) { newIds.push(id); scheduled++; }
          }
        }
      } else {
        for (const step of pending) {
          if (!step.due_date || step.due_date < todayStr || step.due_date > horizon) continue;
          const dbStr = addDays(step.due_date, -1);
          if (dbStr >= todayStr) {
            const sa = localTimeToUTC(dbStr, hour, min, tz);
            if (new Date(sa) > now) {
              const id = await schedulePush({ externalId, title: `📌 "${step.title}" is due tomorrow`, body: `Get a head start for ${goal.title}`, data: { screen: 'GoalStepNotification', action: 'goal_step_tomorrow', goal_id: goal.id, step_id: step.id }, sendAt: sa });
              if (id) { newIds.push(id); scheduled++; }
            }
          }
          const sa2 = localTimeToUTC(step.due_date, hour, min, tz);
          if (new Date(sa2) > now) {
            const id = await schedulePush({ externalId, title: `🎯 "${step.title}" is due today`, body: `Time to work on this for ${goal.title}`, data: { screen: 'GoalStepNotification', action: 'goal_step_due', goal_id: goal.id, step_id: step.id }, buttons: [{ id: 'complete', text: '✅ Done' }, { id: 'remind_later', text: '🔔 Remind Later' }], sendAt: sa2 });
            if (id) { newIds.push(id); scheduled++; }
          }
        }
      }

      const weeksInWindow = {};
      for (const s of weekSteps) {
        if (s.due_date < todayStr || s.due_date > horizon) continue;
        const p = parsePhase(s.phase); if (!p) continue;
        const key = `${p.month}-${p.week}`;
        if (!weeksInWindow[key]) weeksInWindow[key] = { month: p.month, week: p.week, start: s.due_date, titles: [] };
        if (s.due_date < weeksInWindow[key].start) weeksInWindow[key].start = s.due_date;
        if (s.title) weeksInWindow[key].titles.push(s.title);
      }
      for (const wk of Object.values(weeksInWindow)) {
        const monthTheme = goal.month_titles?.[wk.month] || goal.month_titles?.[String(wk.month)];
        const beginAt = localTimeToUTC(wk.start, hour, min, tz);
        if (new Date(beginAt) > now) {
          const id = await schedulePush({ externalId, title: `Week ${wk.week} begins! 🚀`, body: monthTheme ? `"${monthTheme}" — this week: ${wk.titles.slice(0, 2).join(' & ') || goal.title}` : `Week ${wk.week} of "${goal.title}" starts now.`, data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, month: wk.month, week: wk.week }, sendAt: beginAt });
          if (id) { newIds.push(id); scheduled++; }
        }
        const endStr = addDays(wk.start, 6);
        if (endStr <= horizon) {
          const endAt = localTimeToUTC(endStr, 19, 0, tz);
          if (new Date(endAt) > now) {
            const id = await schedulePush({ externalId, title: `Week ${wk.week} wrap-up 🏁`, body: `How did this week on "${goal.title}" go? Check your progress.`, data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, month: wk.month, week: wk.week }, sendAt: endAt });
            if (id) { newIds.push(id); scheduled++; }
          }
        }
      }

      await base44.asServiceRole.entities.Goal.update(goal.id, { onesignal_notification_ids: newIds });

      if (sweep) {
        const d1 = addDays(todayStr, -1), d3 = addDays(todayStr, -3);
        for (const s of pending) {
          if (s.due_date === d1) { await schedulePush({ externalId, title: `"${s.title}" is 1 day overdue ⚠️`, body: `Missed it yesterday — mark done or reschedule?`, data: { screen: 'GoalStepNotification', action: 'goal_step_followup', goal_id: goal.id, step_id: s.id }, buttons: [{ id: 'complete', text: '✅ Done' }, { id: 'remind_later', text: '🔔 Remind Later' }] }); sent++; }
          if (s.due_date === d3) { await schedulePush({ externalId, title: `Still on your list: "${s.title}"`, body: `Waiting 3 days. Mark done, adjust, or move on — your call.`, data: { screen: 'GoalStepNotification', action: 'goal_step_followup', goal_id: goal.id, step_id: s.id } }); sent++; }
        }
        if (isSunday) {
          const wkStart = addDays(todayStr, -6);
          const due = steps.filter(s => s.due_date >= wkStart && s.due_date <= todayStr);
          const done = due.filter(s => s.status === 'completed');
          if (due.length) { const pct = Math.round(done.length / due.length * 100); const e = pct >= 80 ? '🌟' : pct >= 50 ? '💪' : '🔄'; await schedulePush({ externalId, title: `Week wrap-up ${e}`, body: `${done.length}/${due.length} steps on "${goal.title}" (${pct}%).`, data: { screen: 'GoalDetail', action: 'week_stats', goal_id: goal.id } }); sent++; }
        }
        if (isLastOfMonth) {
          const mStart = `${todayStr.slice(0, 7)}-01`;
          const due = steps.filter(s => s.due_date >= mStart && s.due_date <= todayStr);
          const done = due.filter(s => s.status === 'completed');
          if (due.length) { const pct = Math.round(done.length / due.length * 100); const e = pct >= 80 ? '🏆' : pct >= 50 ? '📈' : '💡'; await schedulePush({ externalId, title: `Month complete! ${e}`, body: `This month on "${goal.title}": ${done.length}/${due.length} (${pct}%).`, data: { screen: 'GoalDetail', action: 'month_stats', goal_id: goal.id } }); sent++; }
        }
        if (isMonday) {
          const since = addDays(todayStr, -14);
          const recent = steps.filter(s => s.due_date >= since && s.due_date < todayStr);
          const doneRecent = recent.filter(s => s.status === 'completed' || s.status === 'skipped').length;
          if (recent.length >= 3 && doneRecent / recent.length < 0.3) { await schedulePush({ externalId, title: `Let's recalibrate 🔄`, body: `Tough couple weeks on "${goal.title}" — that's okay. Tap to adjust your plan.`, data: { screen: 'GoalStepNotification', action: 'goal_plan_nudge', goal_id: goal.id } }); sent++; }
          const since7 = addDays(todayStr, -7);
          const active7 = steps.some(s => (s.completed_at && s.completed_at.split('T')[0] >= since7) || (s.updated_date && s.updated_date.split('T')[0] >= since7 && s.status !== 'pending'));
          if (!active7 && steps.length > 0) { await schedulePush({ externalId, title: `Your goal misses you 💙`, body: `A week since any activity on "${goal.title}". Shift your plan forward and start fresh?`, data: { screen: 'GoalStepNotification', action: 'inactivity_nudge', goal_id: goal.id, can_shift_week: true } }); sent++; }
        }
      } else {
        const firstDue = weekSteps[0]?.due_date;
        if (firstDue && firstDue > todayStr) {
          const monthName = new Date(firstDue + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
          const id = await schedulePush({ externalId, title: `Your plan is ready! 🎉`, body: `"${goal.title}" kicks off in ${monthName}. I'll nudge you when it's time to start.`, data: { screen: 'GoalDetail', action: 'plan_ready', goal_id: goal.id }, sendAt: new Date(now.getTime() + 2 * 60 * 1000).toISOString() });
          if (id) { newIds.push(id); scheduled++; await base44.asServiceRole.entities.Goal.update(goal.id, { onesignal_notification_ids: newIds }); }
        }
      }
    }

    return Response.json({ ok: true, mode: sweep ? 'sweep' : 'single', goals: goals.length, scheduled, cancelled, sent });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});