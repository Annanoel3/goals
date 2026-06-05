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
      { id: 'complete', text: "✅ Done" },
      { id: 'remind_later', text: "⏰ Remind Later" },
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all active goals for this user
    const goals = await base44.entities.Goal.filter({ status: 'active' });
    
    let rescheduled = 0;
    for (const goal of goals) {
      // Call scheduleGoalNotifications with full goal object so preferences (include_weekend_reminders, etc.) are respected
      try {
        const tzOffsetMinutes = -new Date().getTimezoneOffset();
        await base44.functions.invoke('scheduleGoalNotifications', { 
          goal_id: goal.id, 
          goal_data: goal,
          timezoneOffsetMinutes: tzOffsetMinutes
        });
        rescheduled++;
      } catch (err) {
        console.error(`Failed to reschedule notifications for goal ${goal.id}:`, err.message);
      }
    }

    return Response.json({ ok: true, rescheduled });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});