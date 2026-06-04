import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { createClient } from 'npm:@supabase/supabase-js@2.38.4';

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

    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));

    // Fetch goal with retry via Supabase — goal may not be committed yet when this is called
    let goal = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data, error } = await supabase.from('Goal').select('*').eq('id', goal_id).single();
      if (data && !error) {
        goal = data;
        console.log(`[scheduleGoalNotificationsOnCreate] goal found on attempt ${attempt}`);
        break;
      }
      console.log(`[scheduleGoalNotificationsOnCreate] goal not found yet, waiting... (attempt ${attempt}/5)`, error?.message);
      if (attempt < 5) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    if (!goal) {
      return Response.json({ success: false, error: 'Goal not found after retries' }, { status: 404 });
    }

    // Fetch user profile via Supabase
    const { data: userData } = await supabase.from('User').select('*').eq('email', user_email).single();
    const user = userData;

    const notifTime = user?.preferred_notification_time || goal.preferred_time || '09:00';
    const tzOffset = user?.timezone_offset || 0;
    console.log('[scheduleGoalNotificationsOnCreate] goal title:', goal.title, '| notifTime:', notifTime, '| tzOffset:', tzOffset, '| user found:', !!user);

    // Fetch top-level steps via Supabase, sorted by order_index
    const { data: allSteps } = await supabase.from('GoalStep').select('*').eq('goal_id', goal_id);
    const topLevel = (allSteps || [])
      .filter(function(s) { return !s.parent_step_id && s.status !== 'completed' && s.status !== 'skipped'; })
      .sort(function(a, b) { return (a.order_index || 0) - (b.order_index || 0); });

    // Find Week 1 steps by phase label, fall back to first step
    const week1 = topLevel.filter(function(s) { return s.phase && /week\s*1/i.test(s.phase); });
    const focusStep = week1[0] || topLevel[0];
    const week1Focus = focusStep ? focusStep.title : goal.title;
    const goalTitle = goal.title || 'your goal';
    console.log('[scheduleGoalNotificationsOnCreate] Week 1 focus:', week1Focus);

    // Build notification schedule based on goal's notification_frequency
    const freq = goal.notification_frequency || 'daily';

    // Determine which days to send notifications in the next 7-day window.
    // PRIORITY: notification_days (specific days of week set during planning) > frequency fallback.
    const today = new Date();
    let daysToNotify = [];

    if (goal.notification_days && goal.notification_days.length > 0) {
      // User specified exact days of week (0=Sun ... 6=Sat). Map to offset days within next 7 days.
      for (let d = 1; d <= 7; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        const dow = date.getDay();
        if (goal.notification_days.includes(dow)) {
          daysToNotify.push(d);
        }
      }
      // Fallback: if none found in next 7 days (e.g. only 1 day/week), pick the nearest
      if (daysToNotify.length === 0) {
        daysToNotify = [1];
      }
    } else if (freq === 'daily') {
      daysToNotify = [1, 2, 3, 4, 5, 6, 7];
    } else if (freq === 'weekdays') {
      for (let d = 1; d <= 7; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        const dow = date.getDay();
        if (dow >= 1 && dow <= 5) daysToNotify.push(d);
      }
    } else if (freq === '3x_per_week') {
      daysToNotify = [1, 3, 5];
    } else if (freq === '2x_per_week') {
      daysToNotify = [1, 4];
    } else if (freq === 'weekly' || freq === 'once_per_week') {
      daysToNotify = [1];
    } else {
      daysToNotify = [1, 2, 3, 4, 5, 6, 7];
    }

    // Build personalized messages — use event_format if available for social/career/relationship goals
    const eventFormat = goal.event_format || null;
    const eventCadence = goal.event_cadence || null;
    const activityLabel = eventFormat
      ? eventFormat
      : week1Focus;

    const allMessages = eventFormat
      ? [
          // Social/relationship/career event-style messages
          { t: "Time for your " + eventFormat + "! 🎉", b: "Don't let it slip — schedule it today for " + goalTitle + "." },
          { t: "Keeping the streak going 💪", b: "Your " + (eventCadence || 'regular') + " " + eventFormat + " makes a bigger difference than you think." },
          { t: goalTitle + " check-in", b: "Have you planned your next " + eventFormat + "? Don't wait — put it on the calendar." },
          { t: "Connection matters 🤝", b: "One " + eventFormat + " at a time. Keep showing up for " + goalTitle + "." },
          { t: "Don't let it slide", b: "Your " + eventFormat + " won't happen by accident — make it happen for " + goalTitle + "." },
          { t: "One more this " + (eventCadence === 'monthly' ? 'month' : 'week'), b: "Lock in your " + eventFormat + " before the week ends." },
          { t: "How's " + goalTitle + " going?", b: "Reflect on your last " + eventFormat + " and plan the next one." },
        ]
      : [
          { t: 'Day 1 of ' + goalTitle, b: 'Week 1 focus: ' + activityLabel + ". Let's make it happen!" },
          { t: 'Keep showing up', b: activityLabel + " takes consistency. You've got today — use it." },
          { t: '3 days in on ' + goalTitle, b: "How's " + activityLabel + ' coming along? Small progress beats zero.' },
          { t: 'Halfway through Week 1', b: activityLabel + ' is where the work is — stay on it.' },
          { t: 'Past the easy part', b: 'The new-goal energy fades now. Push through ' + activityLabel + ' anyway.' },
          { t: 'One more push', b: 'Almost through Week 1 of ' + goalTitle + '. Finish ' + activityLabel + ' strong.' },
          { t: 'Week 1 wrap-up', b: "How did " + activityLabel + " go this week? Reflect and prep for Week 2." },
        ];

    // Pick messages evenly spaced across the scheduled days
    const msgs = daysToNotify.map((day, i) => ({
      day,
      msg: allMessages[Math.min(i, allMessages.length - 1)]
    }));

    console.log('[scheduleGoalNotificationsOnCreate] freq:', freq, '| sending', msgs.length, 'notifications on days:', daysToNotify);

    // Fire all notifications in parallel
    const results = await Promise.all(msgs.map(async ({ day, msg }) => {
      const sendAt = buildSendAtISO(notifTime, day, tzOffset);
      const notifPayload = {
        app_id: appId,
        include_external_user_ids: [String(user_email)],
        channel_for_external_user_ids: 'push',
        headings: { en: msg.t },
        contents: { en: msg.b },
        send_after: sendAt,
        data: { goal_id: goal_id, type: 'goal_reminder', week: 1, day: day },
      };
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + restApiKey },
        body: JSON.stringify(notifPayload),
      });
      const resData = await res.json();
      if (!res.ok) {
        console.error('[scheduleGoalNotificationsOnCreate] day ' + day + ' error:', JSON.stringify(resData));
        return { day, success: false, error: resData };
      }
      return { day, success: true, id: resData.id };
    }));

    const ok = results.filter(function(r) { return r.success; }).length;
    console.log('[scheduleGoalNotificationsOnCreate] Done:', ok + '/' + msgs.length + ' scheduled');
    return Response.json({ success: true, scheduled: ok, total: msgs.length, frequency: freq, week1_focus: week1Focus, results: results });

  } catch (err) {
    console.error('[scheduleGoalNotificationsOnCreate] ERROR:', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});