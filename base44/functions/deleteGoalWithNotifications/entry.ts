import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();
const ONESIGNAL_AUTH_HEADER = `Basic ${ONESIGNAL_REST_API_KEY}`;

async function cancelNotification(notifId) {
  try {
    const res = await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': ONESIGNAL_AUTH_HEADER },
    });
    return res.ok;
  } catch (_) { return false; }
}

// Broad-sweep backstop: cancel EVERY scheduled OneSignal notification whose data
// payload is tagged with this goal_id — even if its id was never stored on a record.
async function cancelAllNotificationsForGoal(goalId) {
  let cancelled = 0;
  let offset = 0;
  const limit = 50;
  while (true) {
    const res = await fetch(
      `https://api.onesignal.com/notifications?app_id=${ONESIGNAL_APP_ID}&limit=${limit}&offset=${offset}&kind=1`,
      { headers: { Authorization: ONESIGNAL_AUTH_HEADER, Accept: 'application/json' } }
    );
    if (!res.ok) break;
    const json = await res.json();
    const notifications = json.notifications || [];
    if (notifications.length === 0) break;

    const matching = notifications.filter(n => {
      const d = n.data || {};
      return d.goal_id === goalId || d.goalId === goalId;
    });
    const results = await Promise.all(matching.map(n => cancelNotification(n.id)));
    cancelled += results.filter(Boolean).length;

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

    // Targeted cancel: IDs stored on goal/step records
    await Promise.all(allIds.map(id => cancelNotification(id)));

    // Backstop: catch any scheduled notifications for this goal whose ids weren't stored
    let swept = 0;
    try { swept = await cancelAllNotificationsForGoal(goal_id); } catch (_) {}

    return Response.json({ ok: true, cancelled: allIds.length, swept, steps_cleaned: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});