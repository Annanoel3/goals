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

    // Cancel goal-level notifications (monthly summaries, etc.)
    if (goal) {
      const goalNotifIds = goal.onesignal_notification_ids || [];
      for (const nid of goalNotifIds) {
        await cancelNotification(nid);
        cancelled++;
      }
    }

    // Cancel all OneSignal notifications for all steps
    for (const step of steps) {
      const notifIds = step.onesignal_notification_ids || [];
      for (const nid of notifIds) {
        await cancelNotification(nid);
        cancelled++;
      }
      
      // Also cancel habit notifications if they exist
      if (step.habit_notification_id) {
        await cancelNotification(step.habit_notification_id);
        cancelled++;
      }
    }

    // Delete all steps first, then the goal
    for (const step of steps) {
      await base44.entities.GoalStep.delete(step.id);
    }

    // Delete the goal
    await base44.entities.Goal.delete(goal_id);

    return Response.json({ ok: true, cancelled, steps_cleaned: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});