import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  console.log('[scheduleGoalNotificationsOnCreate] ========== START ==========');
  try {
    const bodyText = await req.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch (e) {
      return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { goal_id, user_email, goal_start_date } = payload;
    console.log('[scheduleGoalNotificationsOnCreate] goal_id:', goal_id, 'user_email:', user_email, 'start_date:', goal_start_date);

    if (!user_email) {
      console.error('[scheduleGoalNotificationsOnCreate] No user_email in payload — cannot schedule notifications');
      return Response.json({ success: false, error: 'user_email is required' }, { status: 400 });
    }

    if (!goal_id) {
      console.error('[scheduleGoalNotificationsOnCreate] No goal_id in payload');
      return Response.json({ success: false, error: 'goal_id is required' }, { status: 400 });
    }

    // Calculate notification dates: 1 day, 3 days, 1 week, 2 weeks, 1 month, 3 months from now
    const now = new Date();
    const scheduleDates = [
      new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),   // 1 day
      new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),   // 3 days
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),   // 1 week
      new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),  // 2 weeks
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),  // 1 month
      new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),  // 3 months
    ];

    const notifications = [
      { title: "How's your goal going?", message: "Check in on your progress — small steps count!" },
      { title: "Keep the momentum!", message: "You're 3 days in. Take a moment to review your plan." },
      { title: "One week milestone!", message: "A week into your goal. How are you tracking?" },
      { title: "Two weeks in!", message: "Halfway through your first month. Time to reflect on your progress." },
      { title: "One month check-in", message: "A whole month! Review your goal and celebrate what you've accomplished." },
      { title: "3-month milestone", message: "Three months strong! Take stock of how far you've come." },
    ];

    const appBaseUrl = Deno.env.get('APP_BASE_URL') || 'https://app.base44.app';
    const sendPushUrl = `${appBaseUrl}/api/apps/${Deno.env.get('BASE44_APP_ID')}/functions/sendOneSignalPush`;

    // Actually just call sendOneSignalPush directly via fetch to its endpoint
    // Use the same base URL pattern as how functions call each other in base44
    const results = [];
    for (let i = 0; i < notifications.length; i++) {
      try {
        const pushPayload = {
          userEmail: user_email,
          title: notifications[i].title,
          message: notifications[i].message,
          sendAtISO: scheduleDates[i].toISOString(),
          data: { goal_id, type: 'goal_reminder' }
        };
        console.log(`[scheduleGoalNotificationsOnCreate] Scheduling notification ${i + 1}:`, JSON.stringify(pushPayload));

        // Call sendOneSignalPush via base44 function invoke
        const base44 = createClientFromRequest(req);
        const result = await base44.functions.invoke('sendOneSignalPush', pushPayload);
        console.log(`[scheduleGoalNotificationsOnCreate] Notification ${i + 1} result:`, JSON.stringify(result));
        results.push({ index: i, success: true, result });
      } catch (err) {
        console.error(`[scheduleGoalNotificationsOnCreate] Notification ${i + 1} failed:`, err.message);
        results.push({ index: i, success: false, error: err.message });
      }
    }

    console.log('[scheduleGoalNotificationsOnCreate] ========== DONE ==========', results);
    return Response.json({ success: true, scheduled: results.length, results });
  } catch (error) {
    console.error('[scheduleGoalNotificationsOnCreate] Unhandled error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});