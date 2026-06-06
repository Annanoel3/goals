import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

async function cancelNotification(notifId) {
  try {
    const res = await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
    return res.ok;
  } catch (_) { return false; }
}

// Fetch ALL scheduled notifications from OneSignal and cancel any that belong to this goal
async function cancelAllNotificationsForGoal(goalId) {
  let cancelled = 0;
  let offset = 0;
  const limit = 50;

  while (true) {
    let data;
    try {
      const res = await fetch(
        `https://onesignal.com/api/v1/notifications?app_id=${ONESIGNAL_APP_ID}&limit=${limit}&offset=${offset}&kind=1`,
        { headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` } }
      );
      data = await res.json();
    } catch (_) { break; }

    const notifications = data?.notifications || [];
    if (notifications.length === 0) break;

    for (const notif of notifications) {
      const d = notif.data || {};
      if (d.goal_id === goalId || d.goalId === goalId) {
        const ok = await cancelNotification(notif.id);
        if (ok) cancelled++;
      }
    }

    // If fewer results than limit, we've reached the end
    if (notifications.length < limit) break;
    offset += limit;
  }

  return cancelled;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { goal_id } = body;
    if (!goal_id) return Response.json({ error: 'Missing goal_id' }, { status: 400 });

    // Get the goal and all its steps — gather notification IDs BEFORE deleting
    const goalResults = await base44.asServiceRole.entities.Goal.filter({ id: goal_id });
    const goal = goalResults[0];
    const steps = await base44.entities.GoalStep.filter({ goal_id });

    const allIds = [
      ...(goal?.onesignal_notification_ids || []),
      ...steps.flatMap(s => [
        ...(s.onesignal_notification_ids || []),
        ...(s.habit_notification_id ? [s.habit_notification_id] : []),
      ]),
    ];

    // Delete records first — goal is truly gone, UI delete sticks, no refetch resurrection
    await Promise.all(steps.map(s => base44.entities.GoalStep.delete(s.id)));
    await base44.entities.Goal.delete(goal_id);

    // Cancel OneSignal notifications in parallel (not sequential)
    await Promise.all(allIds.map(id => cancelNotification(id)));

    return Response.json({ ok: true, cancelled: allIds.length, steps_cleaned: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});