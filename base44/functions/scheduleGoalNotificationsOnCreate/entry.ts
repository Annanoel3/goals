Deno.serve(async (req) => {
  console.log('[scheduleGoalNotificationsOnCreate] START');
  try {
    const bodyText = await req.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch (e) {
      return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { goal_id, user_email, goal_start_date } = payload;
    console.log('[scheduleGoalNotificationsOnCreate] goal_id:', goal_id, 'user_email:', user_email);

    if (!user_email) {
      console.error('[scheduleGoalNotificationsOnCreate] MISSING user_email');
      return Response.json({ success: false, error: 'user_email is required' }, { status: 400 });
    }

    const appId = Deno.env.get('ONESIGNAL_APP_ID')?.trim();
    const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY')?.trim();

    if (!appId || !restApiKey) {
      console.error('[scheduleGoalNotificationsOnCreate] Missing OneSignal env vars');
      return Response.json({ success: false, error: 'Missing OneSignal config' }, { status: 500 });
    }

    const now = new Date();
    const schedule = [
      { offsetDays: 1,  title: "How's your goal going?",  body: "Check in on your progress — small steps count!" },
      { offsetDays: 3,  title: "Keep the momentum!",       body: "You're 3 days in. Take a moment to review your plan." },
      { offsetDays: 7,  title: "One week milestone!",      body: "A week into your goal. How are you tracking?" },
      { offsetDays: 14, title: "Two weeks in!",            body: "Time to reflect on your progress so far." },
      { offsetDays: 30, title: "One month check-in",       body: "A whole month! Celebrate what you've accomplished." },
      { offsetDays: 90, title: "3-month milestone",        body: "Three months strong! Take stock of how far you've come." },
    ];

    const results = [];
    for (const item of schedule) {
      const sendAt = new Date(now.getTime() + item.offsetDays * 24 * 60 * 60 * 1000);
      const notifPayload = {
        app_id: appId,
        include_external_user_ids: [String(user_email)],
        channel_for_external_user_ids: 'push',
        headings: { en: item.title },
        contents: { en: item.body },
        send_after: sendAt.toISOString(),
        data: { goal_id, type: 'goal_reminder' },
      };

      console.log(`[scheduleGoalNotificationsOnCreate] Sending +${item.offsetDays}d:`, item.title);

      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${restApiKey}`,
        },
        body: JSON.stringify(notifPayload),
      });

      const text = await res.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { raw: text }; }

      console.log(`[scheduleGoalNotificationsOnCreate] +${item.offsetDays}d result:`, JSON.stringify(result));
      results.push({ offsetDays: item.offsetDays, ok: res.ok, result });
    }

    console.log('[scheduleGoalNotificationsOnCreate] DONE — scheduled', results.length, 'notifications');
    return Response.json({ success: true, count: results.length, results });

  } catch (err) {
    console.error('[scheduleGoalNotificationsOnCreate] ERROR:', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});