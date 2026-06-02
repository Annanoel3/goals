import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id } = await req.json();

    if (!goal_id) {
      return Response.json({ error: 'goal_id required' }, { status: 400 });
    }

    // Just invoke the main scheduler with 7-day window
    const result = await base44.asServiceRole.functions.invoke('cronGoalNotifications', {
      goal_id,
      days_ahead: 7
    });

    return Response.json({ scheduled: true, result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});