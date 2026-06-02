import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

async function schedulePush({ externalId, title, body, data, sendAt, buttons }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    channel_for_external_user_ids: 'push',
    headings: { en: title },
    contents: { en: body },
    data,
    send_after: sendAt,
    ...(buttons ? { buttons } : {}),
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[OneSignal Error] ${res.status}: ${errText}`);
  }
  const json = await res.json();
  return json?.id || null;
}

async function cancelPush(notifId) {
  try {
    await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch (_) {}
}

function parsePhase(phase) {
  if (!phase) return null;
  const full = phase.match(/Month\s+(\d+)\s+Week\s+(\d+)/i);
  if (full) return { month: parseInt(full[1]), week: parseInt(full[2]) };
  const monthOnly = phase.match(/Month\s+(\d+)/i);
  if (monthOnly) return { month: parseInt(monthOnly[1]), week: null };
  return null;
}

function localTimeOnDate(dateStr, localHour, localMin, tzOffsetMinutes) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(
    localHour + Math.floor(tzOffsetMinutes / 60),
    localMin + (tzOffsetMinutes % 60),
    0, 0
  );
  return d;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id } = await req.json();

    if (!goal_id) {
      return Response.json({ error: 'goal_id required' }, { status: 400 });
    }

    const goal = await base44.asServiceRole.entities.Goal.get(goal_id);
    if (!goal) {
      return Response.json({ error: 'goal not found' }, { status: 404 });
    }

    const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
    if (!user) {
      return Response.json({ error: 'user not found' }, { status: 404 });
    }

    const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
    const externalId = user.email;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    let prefHour = 9, prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) { prefHour = parseInt(tp[1]); prefMin = parseInt(tp[2]); }
    }
    const tzOffset = user.timezone_offset || 0;

    let scheduled = 0;

    // 7-day notification window
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const windowEndStr = windowEnd.toISOString().split('T')[0];

    // Schedule step-level notifications (non-daily habits)
    for (const step of steps) {
      if (step.due_date && !step.is_daily_habit && step.due_date >= todayStr && step.due_date <= windowEndStr) {
        const dayBeforeStr = addDays(step.due_date, -1);
        const dayBeforeSendAt = localTimeOnDate(dayBeforeStr, prefHour, prefMin, tzOffset);
        if (dayBeforeSendAt > now) {
          const nid = await schedulePush({
            externalId,
            title: `📌 "${step.title}" is due tomorrow`,
            body: `Get a head start on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_tomorrow', goal_id: goal.id, step_id: step.id },
            sendAt: dayBeforeSendAt.toISOString(),
            buttons: [{ id: 'complete', text: '✅ Done' }, { id: 'remind_later', text: '🔔 Remind Later' }],
          });
          if (nid) scheduled++;
        }

        const dueSendAt = localTimeOnDate(step.due_date, prefHour, prefMin, tzOffset);
        if (dueSendAt > now) {
          const nid = await schedulePush({
            externalId,
            title: `🎯 "${step.title}" is due today`,
            body: `Time to work on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_due', goal_id: goal.id, step_id: step.id },
            sendAt: dueSendAt.toISOString(),
            buttons: [{ id: 'complete', text: '✅ Done' }, { id: 'remind_later', text: '🔔 Remind Later' }],
          });
          if (nid) scheduled++;
        }
      }
    }

    // Build week/month maps from step phases and due_dates
    const weekMap = {};
    const monthMap = {};
    for (const step of steps) {
      if (!step.due_date) continue;
      const p = parsePhase(step.phase);
      if (!p) continue;
      const mk = String(p.month);
      if (!monthMap[mk]) monthMap[mk] = { month: p.month, dates: [] };
      monthMap[mk].dates.push(step.due_date);
      if (p.week !== null) {
        const wk = `${p.month}-${p.week}`;
        if (!weekMap[wk]) weekMap[wk] = { month: p.month, week: p.week, dates: [], titles: [] };
        weekMap[wk].dates.push(step.due_date);
        if (step.title) weekMap[wk].titles.push(step.title);
      }
    }

    // Schedule week begin + end notifications
    for (const wData of Object.values(weekMap)) {
      const sortedDates = [...wData.dates].sort();
      const weekEndDate = sortedDates[sortedDates.length - 1];
      const weekStartDate = addDays(weekEndDate, -6);
      const monthTheme = goal.month_titles?.[wData.month];
      const weekFocus = wData.titles.slice(0, 2).join(' & ') || monthTheme || goal.title;

      const weekBeginSendAt = localTimeOnDate(weekStartDate, prefHour, prefMin, tzOffset);
      if (weekBeginSendAt > now && weekStartDate <= windowEndStr) {
        const nid = await schedulePush({
          externalId,
          title: `📅 Month ${wData.month}, Week ${wData.week} begins`,
          body: monthTheme ? `This week is part of "${monthTheme}". Focus: ${weekFocus} 🚀` : `Week ${wData.week} of "${goal.title}" starts now. This week: ${weekFocus} 🚀`,
          data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekBeginSendAt.toISOString(),
        });
        if (nid) scheduled++;
      }

      const weekEndSendAt = localTimeOnDate(weekEndDate, 19, 0, tzOffset);
      if (weekEndSendAt > now) {
        const nid = await schedulePush({
          externalId,
          title: `🏁 Week ${wData.week} wrap-up`,
          body: monthTheme ? `Week ${wData.week} of "${monthTheme}" is done. How'd it go? Check your progress. 💪` : `Week ${wData.week} of "${goal.title}" is wrapping up. Reflect on what you accomplished. 💪`,
          data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekEndSendAt.toISOString(),
        });
        if (nid) scheduled++;
      }
    }

    // Schedule month begin + end notifications
    for (const mData of Object.values(monthMap)) {
      const sortedDates = [...mData.dates].sort();
      const monthStartDate = sortedDates[0];
      const monthEndDate = sortedDates[sortedDates.length - 1];
      const monthTheme = goal.month_titles?.[mData.month];

      const mBeginSendAt = localTimeOnDate(monthStartDate, prefHour, prefMin, tzOffset);
      if (mBeginSendAt > now) {
        const nid = await schedulePush({
          externalId,
          title: `📅 Month ${mData.month} begins`,
          body: monthTheme ? `Month ${mData.month} is all about "${monthTheme}" for "${goal.title}". Let's go! 🎯` : `Month ${mData.month} of "${goal.title}" starts now. Make it count! 🎯`,
          data: { screen: 'GoalDetail', action: 'month_begin', goal_id: goal.id, month: mData.month },
          sendAt: mBeginSendAt.toISOString(),
        });
        if (nid) scheduled++;
      }

      const mEndSendAt = localTimeOnDate(monthEndDate, 19, 0, tzOffset);
      if (mEndSendAt > now) {
        const nid = await schedulePush({
          externalId,
          title: monthTheme ? `🌟 Month ${mData.month}: "${monthTheme}" — complete!` : `🌟 Month ${mData.month} complete!`,
          body: `How did Month ${mData.month} go for "${goal.title}"? Zoom out — see the full picture. 📊`,
          data: { screen: 'GoalDetail', action: 'month_end', goal_id: goal.id, month: mData.month },
          sendAt: mEndSendAt.toISOString(),
        });
        if (nid) scheduled++;
      }
    }

    return Response.json({ scheduled, goal_id });
  } catch (error) {
    console.error('[scheduleGoalNotificationsOnCreate error]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});