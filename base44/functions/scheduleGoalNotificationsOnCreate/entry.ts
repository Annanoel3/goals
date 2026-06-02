import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id } = await req.json();

    if (!goal_id) {
      return Response.json({ error: 'goal_id required' }, { status: 400 });
    }

    // Call the existing rescheduler which handles the 7-day rolling window
    const result = await base44.asServiceRole.functions.invoke('rescheduleAllGoalNotifications', {
      goal_id,
    });

    return Response.json({ scheduled: true, ...result });
  } catch (error) {
    console.error('[scheduleGoalNotificationsOnCreate error]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});