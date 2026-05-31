import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

async function cancelNotification(notifId) {
  try {
    await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch (_) {}
}

async function scheduleNotification({ externalId, title, body, data, sendAt }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    headings: { en: title },
    contents: { en: body },
    data,
    channel_for_external_user_ids: 'push',
    send_after: sendAt,
    buttons: [
      { id: 'complete', text: '✅ Done' },
      { id: 'remind_later', text: '🔔 Remind Later' },
    ],
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return json?.id || null;
}

// Parse "Month 1 Week 2" -> { month: 1, week: 2 }
// Parse "Month 3" -> { month: 3, week: null }
function parsePhase(phase) {
  if (!phase) return null;
  const full = phase.match(/Month\s+(\d+)\s+Week\s+(\d+)/i);
  if (full) return { month: parseInt(full[1]), week: parseInt(full[2]) };
  const monthOnly = phase.match(/Month\s+(\d+)/i);
  if (monthOnly) return { month: parseInt(monthOnly[1]), week: null };
  return null;
}

// Return a UTC Date for localHour:localMin on the given YYYY-MM-DD string
function localTimeOnDate(dateStr, localHour, localMin, tzOffsetMinutes) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(
    localHour + Math.floor(tzOffsetMinutes / 60),
    localMin + (tzOffsetMinutes % 60),
    0, 0
  );
  return d;
}

// Add N days to a YYYY-MM-DD string, return new YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id, timezoneOffsetMinutes } = await req.json();
    if (!goal_id) return Response.json({ error: 'goal_id required' }, { status: 400 });

    const tzOffset = typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0;
    const now = new Date();

    const goal = await base44.asServiceRole.entities.Goal.get(goal_id);
    if (!goal) return Response.json({ error: 'Goal not found' }, { status: 404 });

    const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
    const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
    const externalId = user?.email;
    if (!externalId) return Response.json({ error: 'No user email' }, { status: 400 });

    // Preferred notification time (default 9 AM)
    let prefHour = 9, prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) { prefHour = parseInt(tp[1]); prefMin = parseInt(tp[2]); }
    }

    let scheduled = 0, cancelled = 0;

    // ── STEP-LEVEL NOTIFICATIONS ──
    // Daily habit notifications are handled entirely by cronDailyHabitNotifications.
    // Here we only schedule: day-before reminder + due-date reminder for milestone steps.
    for (const step of steps) {
      const existingIds = step.onesignal_notification_ids || [];
      for (const nid of existingIds) { await cancelNotification(nid); cancelled++; }

      const newNotifIds = [];

      if (step.due_date && !step.is_daily_habit) {
        // Day-before reminder
        const dayBeforeStr = addDays(step.due_date, -1);
        const dayBeforeSendAt = localTimeOnDate(dayBeforeStr, prefHour, prefMin, tzOffset);
        if (dayBeforeSendAt > now) {
          const nid = await scheduleNotification({
            externalId,
            title: `📌 "${step.title}" is due tomorrow`,
            body: `Get a head start on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_tomorrow', goal_id: goal.id, step_id: step.id },
            sendAt: dayBeforeSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        }

        // Due-date reminder
        const dueSendAt = localTimeOnDate(step.due_date, prefHour, prefMin, tzOffset);
        if (dueSendAt > now) {
          const nid = await scheduleNotification({
            externalId,
            title: `🎯 "${step.title}" is due today`,
            body: `Time to work on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_due', goal_id: goal.id, step_id: step.id },
            sendAt: dueSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        }
      }

      if (newNotifIds.length > 0 || existingIds.length > 0) {
        await base44.asServiceRole.entities.GoalStep.update(step.id, {
          onesignal_notification_ids: newNotifIds,
        });
      }
    }

    // ── GOAL TYPE DETECTION ──
    // If the goal has any daily habit steps, it's a habit goal — the cron drives daily notifications
    // and the week-4-done trigger fires the celebration. If no daily habit steps exist,
    // it's milestone-based — the month-end notification carries the celebration trigger.
    const isMilestoneGoal = !steps.some(s => s.is_daily_habit && s.habit_time);

    // ── CANCEL OLD GOAL-LEVEL NOTIFICATIONS ──
    const existingGoalNotifIds = goal.onesignal_notification_ids || [];
    for (const nid of existingGoalNotifIds) { await cancelNotification(nid); cancelled++; }
    const goalNotifIds = [];

    // ── BUILD WEEK/MONTH MAP from step phases and due_dates ──
    // This derives all timing from actual step data — no dependency on created_date or now.
    const weekMap = {};   // key: "month-week"
    const monthMap = {};  // key: "month"

    for (const step of steps) {
      if (!step.due_date) continue;
      const p = parsePhase(step.phase);
      if (!p) continue;

      // Month map
      const mk = String(p.month);
      if (!monthMap[mk]) monthMap[mk] = { month: p.month, dates: [] };
      monthMap[mk].dates.push(step.due_date);

      // Week map
      if (p.week !== null) {
        const wk = `${p.month}-${p.week}`;
        if (!weekMap[wk]) weekMap[wk] = { month: p.month, week: p.week, dates: [], titles: [] };
        weekMap[wk].dates.push(step.due_date);
        if (step.title) weekMap[wk].titles.push(step.title);
      }
    }

    // ── WEEK BEGIN + END NOTIFICATIONS ──
    for (const wData of Object.values(weekMap)) {
      const sortedDates = [...wData.dates].sort();
      const weekEndDate = sortedDates[sortedDates.length - 1];
      const weekStartDate = addDays(weekEndDate, -6);

      const monthTheme = goal.month_titles?.[wData.month];
      // First 2 step titles for this week give the user something concrete to read
      const weekFocus = wData.titles.slice(0, 2).join(' & ') || monthTheme || goal.title;

      // Week begin — morning of week start
      const weekBeginSendAt = localTimeOnDate(weekStartDate, prefHour, prefMin, tzOffset);
      if (weekBeginSendAt > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `📅 Month ${wData.month}, Week ${wData.week} begins`,
          body: monthTheme
            ? `This week is part of "${monthTheme}". Focus: ${weekFocus} 🚀`
            : `Week ${wData.week} of "${goal.title}" starts now. This week: ${weekFocus} 🚀`,
          data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekBeginSendAt.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      // Week end — evening of last due date in week
      const weekEndSendAt = localTimeOnDate(weekEndDate, 19, 0, tzOffset);
      if (weekEndSendAt > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `🏁 Week ${wData.week} wrap-up`,
          body: monthTheme
            ? `Week ${wData.week} of "${monthTheme}" is done. How'd it go? Check your progress. 💪`
            : `Week ${wData.week} of "${goal.title}" is wrapping up. Reflect on what you accomplished. 💪`,
          data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekEndSendAt.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }
    }

    // ── MONTH BEGIN + END NOTIFICATIONS ──
    for (const mData of Object.values(monthMap)) {
      const sortedDates = [...mData.dates].sort();
      const monthStartDate = sortedDates[0];
      const monthEndDate = sortedDates[sortedDates.length - 1];
      const monthTheme = goal.month_titles?.[mData.month];

      // Month begin — morning of first step date in that month
      const mBeginSendAt = localTimeOnDate(monthStartDate, prefHour, prefMin, tzOffset);
      if (mBeginSendAt > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `📅 Month ${mData.month} begins`,
          body: monthTheme
            ? `Month ${mData.month} is all about "${monthTheme}" for "${goal.title}". Let's go! 🎯`
            : `Month ${mData.month} of "${goal.title}" starts now. Make it count! 🎯`,
          data: { screen: 'GoalDetail', action: 'month_begin', goal_id: goal.id, month: mData.month },
          sendAt: mBeginSendAt.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      // Month end — evening of last step date in that month
      // For milestone goals: carry trigger_celebration so tapping this notification fires the GIF + summary overlay.
      // For daily habit goals: the celebration already fires when they mark week 4 done.
      const mEndSendAt = localTimeOnDate(monthEndDate, 19, 0, tzOffset);
      if (mEndSendAt > now) {
        const nid = await scheduleNotification({
          externalId,
          title: monthTheme
            ? `🌟 Month ${mData.month}: "${monthTheme}" — complete!`
            : `🌟 Month ${mData.month} complete!`,
          body: `How did Month ${mData.month} go for "${goal.title}"? Zoom out — see the full picture. 📊`,
          data: {
            screen: 'GoalDetail',
            action: 'month_end',
            goal_id: goal.id,
            month: mData.month,
            // Only milestone goals trigger the GIF from notification tap —
            // habit goals get it from marking week 4 done
            ...(isMilestoneGoal && { trigger_celebration: true }),
          },
          sendAt: mEndSendAt.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }
    }

    // Save goal-level notification IDs
    await base44.asServiceRole.entities.Goal.update(goal.id, {
      onesignal_notification_ids: goalNotifIds,
    });

    return Response.json({ ok: true, scheduled, cancelled, steps_processed: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});