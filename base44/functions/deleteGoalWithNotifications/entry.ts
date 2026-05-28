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

    // Get the goal and all its steps
    const goalResults = await base44.asServiceRole.entities.Goal.filter({ id: goal_id });
    const goal = goalResults[0];
    const steps = await base44.entities.GoalStep.filter({ goal_id });

    let cancelled = 0;

    // 1. Cancel IDs stored on the goal record
    if (goal) {
      for (const nid of goal.onesignal_notification_ids || []) {
        await cancelNotification(nid);
        cancelled++;
      }
    }

    // 2. Cancel IDs stored on each step record (including habit_notification_id)
    for (const step of steps) {
      for (const nid of step.onesignal_notification_ids || []) {
        await cancelNotification(nid);
        cancelled++;
      }
      if (step.habit_notification_id) {
        await cancelNotification(step.habit_notification_id);
        cancelled++;
      }
    }

    // 3. Sweep OneSignal for any scheduled notifications with this goal_id in their data
    //    (catches notifications whose IDs were never saved back to the entity)
    const sweptCount = await cancelAllNotificationsForGoal(goal_id);
    cancelled += sweptCount;

    // Delete all steps first, then the goal
    for (const step of steps) {
      await base44.entities.GoalStep.delete(step.id);
    }
    await base44.entities.Goal.delete(goal_id);

    return Response.json({ ok: true, cancelled, steps_cleaned: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});