import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Parse time strings in 'HH:MM' or 'H:MM AM/PM' format
function parseNotifTime(timeStr) {
  if (!timeStr) return [9, 0];
  const ampm = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const mer = ampm[3].toUpperCase();
    if (mer === 'PM' && h !== 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return [h, m];
  }
  const parts = timeStr.split(':').map(Number);
  return [parts[0] != null ? parts[0] : 9, parts[1] != null ? parts[1] : 0];
}

// Build ISO send_after: user preferred time N days from now
function buildSendAtISO(notifTime, daysFromNow, tzOffsetMinutes) {
  if (tzOffsetMinutes == null) tzOffsetMinutes = 0;
  const p = parseNotifTime(notifTime);
  const candidate = new Date();
  candidate.setDate(candidate.getDate() + daysFromNow);
  candidate.setUTCHours(p[0], p[1], 0, 0);
  candidate.setTime(candidate.getTime() - tzOffsetMinutes * 60 * 1000);
  return candidate.toISOString();
}

Deno.serve(async (req) => {
  console.log('[scheduleGoalNotificationsOnCreate] START');
  try {
    const base44 = createClientFromRequest(req);

    const bodyText = await req.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch (e) {
      return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const goal_id = payload.goal_id;
    const user_email = payload.user_email;
    console.log('[scheduleGoalNotificationsOnCreate] goal_id:', goal_id, 'user_email:', user_email);

    if (!user_email) {
      return Response.json({ success: false, error: 'user_email is required' }, { status: 400 });
    }
    if (!goal_id) {
      return Response.json({ success: false, error: 'goal_id is required' }, { status: 400 });
    }

    const appId = Deno.env.get('ONESIGNAL_APP_ID');
    const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
    if (!appId || !restApiKey) {
      return Response.json({ success: false, error: 'Missing OneSignal config' }, { status: 500 });
    }

    // Fetch goal with retry — goal may not be committed yet when this is called
    let goal = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        goal = await base44.asServiceRole.entities.Goal.get(goal_id);
        if (goal) break;
      } catch (e) {
        console.log(`[scheduleGoalNotificationsOnCreate] attempt ${attempt} failed:`, e.message);
      }
      console.log(`[scheduleGoalNotificationsOnCreate] goal not found yet, waiting... (attempt ${attempt}/5)`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    if (!goal) {
      return Response.json({ success: false, error: 'Goal not found after retries' }, { status: 404 });
    }

    const userList = await base44.asServiceRole.entities.User.filter({ email: user_email });
    const user = userList && userList[0];
    if (!user) {
      return Response.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const notifTime = user.preferred_notification_time || goal.preferred_time || '09:00';
    const tzOffset = user.timezone_offset || 0;
    console.log('[scheduleGoalNotificationsOnCreate] goal title:', goal.title, '| notifTime:', notifTime, '| tzOffset:', tzOffset, '| user found:', !!user);

    // Fetch top-level steps, sorted by order_index
    const allSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal_id });
    const topLevel = (allSteps || [])
      .filter(function(s) { return !s.parent_step_id && s.status !== 'completed' && s.status !== 'skipped'; })
      .sort(function(a, b) { return (a.order_index || 0) - (b.order_index || 0); });

    // Find Week 1 steps by phase label, fall back to first step
    const week1 = topLevel.filter(function(s) { return s.phase && /week\s*1/i.test(s.phase); });
    const focusStep = week1[0] || topLevel[0];
    const week1Focus = focusStep ? focusStep.title : goal.title;
    const goalTitle = goal.title || 'your goal';
    console.log('[scheduleGoalNotificationsOnCreate] Week 1 focus:', week1Focus);

    // 7-day schedule — each message references the specific Week 1 task
    const msgs = [
      { t: 'Day 1 of ' + goalTitle, b: 'Week 1 focus: ' + week1Focus + ". Let's make it happen!" },
      { t: 'Day 2 — keep showing up', b: week1Focus + " takes consistency. You've got today — use it." },
      { t: '3 days in on ' + goalTitle, b: "How's " + week1Focus + ' coming along? Small progress beats zero.' },
      { t: 'Halfway through Week 1', b: '4 days strong. ' + week1Focus + ' is where the work is — stay on it.' },
      { t: 'Day 5 — past the easy part', b: 'The new-goal energy fades now. Push through ' + week1Focus + ' anyway.' },
      { t: 'Day 6 — one more push', b: 'Almost through Week 1 of ' + goalTitle + '. Finish ' + week1Focus + ' strong.' },
      { t: 'Week 1 wrap-up', b: "How did " + week1Focus + " go this week? Reflect and prep for Week 2." },
    ];

    const results = [];
    for (let i = 0; i < 7; i++) {
      const day = i + 1;
      const sendAt = buildSendAtISO(notifTime, day, tzOffset);
      const notifPayload = {
        app_id: appId,
        include_external_user_ids: [String(user_email)],
        channel_for_external_user_ids: 'push',
        headings: { en: msgs[i].t },
        contents: { en: msgs[i].b },
        send_after: sendAt,
        data: { goal_id: goal_id, type: 'goal_reminder', week: 1, day: day },
      };
      console.log('[scheduleGoalNotificationsOnCreate] day ' + day + ' at ' + sendAt);
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + restApiKey },
        body: JSON.stringify(notifPayload),
      });
      const resData = await res.json();
      console.log('[scheduleGoalNotificationsOnCreate] day ' + day + ' response status:', res.status, JSON.stringify(resData));
      if (!res.ok) {
        console.error('[scheduleGoalNotificationsOnCreate] day ' + day + ' error:', JSON.stringify(resData));
        results.push({ day: day, success: false, error: resData });
      } else {
        console.log('[scheduleGoalNotificationsOnCreate] day ' + day + ' success, id:', resData.id);
        results.push({ day: day, success: true, id: resData.id });
      }
    }

    const ok = results.filter(function(r) { return r.success; }).length;
    console.log('[scheduleGoalNotificationsOnCreate] Done:', ok + '/7 scheduled');
    return Response.json({ success: true, scheduled: ok, total: 7, week1_focus: week1Focus, results: results });

  } catch (err) {
    console.error('[scheduleGoalNotificationsOnCreate] ERROR:', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});