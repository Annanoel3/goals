import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const { goal_id, completed_week, timezoneOffsetMinutes } = await req.json();
    
    if (!goal_id) return Response.json({ error: 'goal_id required' }, { status: 400 });

    const tzOffset = typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0;
    const now = new Date();

    // Fetch goal and steps
    const goal = await base44.asServiceRole.entities.Goal.get(goal_id);
    if (!goal) return Response.json({ error: 'Goal not found' }, { status: 404 });

    const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
    const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
    const externalId = user?.email;
    if (!externalId) return Response.json({ error: 'No user email' }, { status: 400 });

    // Preferred notification time
    let prefHour = 9, prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) { prefHour = parseInt(tp[1]); prefMin = parseInt(tp[2]); }
    }

    // Determine next week to schedule
    const nextWeek = (completed_week || 0) + 1;
    const nextMonthNum = Math.ceil(nextWeek / 4);

    // Get all steps for the next week
    const nextWeekSteps = steps.filter(s => {
      const phase = s.phase || '';
      const monthMatch = phase.match(/Month\s*(\d+)/i);
      const weekMatch = phase.match(/Week\s*(\d+)/i);
      const m = monthMatch ? parseInt(monthMatch[1]) : 0;
      const w = weekMatch ? parseInt(weekMatch[1]) : 0;
      return m === nextMonthNum && w === nextWeek;
    });

    if (nextWeekSteps.length === 0) {
      return Response.json({ ok: true, message: 'No more weeks to schedule' });
    }

    // Calculate completion rate for personalization
    const completionRate = (() => {
      if (completed_week < 1) return 0;
      const completedInPrevWeeks = steps.filter(s => {
        const phase = s.phase || '';
        const weekMatch = phase.match(/Week\s*(\d+)/i);
        const w = weekMatch ? parseInt(weekMatch[1]) : 0;
        return w <= completed_week && s.status === 'completed';
      }).length;
      const totalInPrevWeeks = steps.filter(s => {
        const phase = s.phase || '';
        const weekMatch = phase.match(/Week\s*(\d+)/i);
        const w = weekMatch ? parseInt(weekMatch[1]) : 0;
        return w <= completed_week;
      }).length;
      return totalInPrevWeeks > 0 ? Math.round((completedInPrevWeeks / totalInPrevWeeks) * 100) : 0;
    })();

    // Personalize based on pace
    const isAhead = completionRate > 80;
    const isBehind = completionRate < 50 && completed_week > 0;
    const onTrack = !isAhead && !isBehind && completed_week > 0;

    let motivationSuffix = '';
    if (isAhead) {
      motivationSuffix = ' You are ahead of schedule — keep it up!';
    } else if (isBehind) {
      motivationSuffix = ' You are catching up — one step at a time.';
    } else if (onTrack) {
      motivationSuffix = ' You are right on pace — steady progress!';
    }

    // Get due dates for next week steps
    const nextWeekDates = nextWeekSteps
      .filter(s => s.due_date)
      .map(s => s.due_date)
      .sort();

    const weekStartDate = nextWeekDates[0] || addDays(new Date().toISOString().split('T')[0], 7);
    const weekEndDate = nextWeekDates[nextWeekDates.length - 1] || addDays(weekStartDate, 6);

    // Schedule week begin notification
    const weekBeginSendAt = localTimeOnDate(weekStartDate, prefHour, prefMin, tzOffset);
    if (weekBeginSendAt > now) {
      const monthTheme = goal.month_titles?.[nextMonthNum];
      const weekTitle = nextWeekSteps[0]?.description?.split('\n')[0] || 'Next steps';
      
      await scheduleNotification({
        externalId,
        title: `Week ${nextWeek} begins`,
        body: monthTheme
          ? `"${monthTheme}" — Week ${nextWeek} is here. Focus: ${weekTitle}${motivationSuffix}`
          : `Week ${nextWeek} of "${goal.title}" starts now. ${weekTitle}${motivationSuffix}`,
        data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, week: nextWeek, month: nextMonthNum },
        sendAt: weekBeginSendAt.toISOString(),
      });
    }

    // Schedule week end reflection
    const weekEndSendAt = localTimeOnDate(weekEndDate, 19, 0, tzOffset);
    if (weekEndSendAt > now) {
      await scheduleNotification({
        externalId,
        title: `Week ${nextWeek} wrap-up`,
        body: `Reflect on what you accomplished this week. Ready for week ${nextWeek + 1}?`,
        data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, week: nextWeek, month: nextMonthNum },
        sendAt: weekEndSendAt.toISOString(),
      });
    }

    return Response.json({ ok: true, scheduled_week: nextWeek, personalization: { completionRate, isAhead, isBehind, onTrack } });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});