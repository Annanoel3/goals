import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active goals for this user
    const goals = await base44.asServiceRole.entities.Goal.filter({
      created_by: user.email,
      status: 'active'
    });

    const now = new Date();
    const notificationsToSend = [];

    for (const goal of goals) {
      // Fetch all steps for this goal
      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      if (steps.length === 0) continue;

      const targetDate = goal.target_date ? new Date(goal.target_date) : null;
      if (!targetDate) continue;

      // Calculate expected vs actual progress
      const totalDays = (targetDate.getTime() - new Date(goal.created_date).getTime()) / (1000 * 60 * 60 * 24);
      const elapsedDays = (now.getTime() - new Date(goal.created_date).getTime()) / (1000 * 60 * 60 * 24);
      const expectedProgress = Math.max(0, Math.min(1, elapsedDays / totalDays));

      const completedSteps = steps.filter(s => s.status === 'completed').length;
      const actualProgress = steps.length > 0 ? completedSteps / steps.length : 0;

      // If user is falling behind (actual < expected - 10% buffer), send notification
      const progressGap = expectedProgress - actualProgress;
      if (progressGap > 0.1 && elapsedDays > 7) {
        notificationsToSend.push({
          goal_id: goal.id,
          goal_title: goal.title,
          user_email: user.email,
          expected_progress: Math.round(expectedProgress * 100),
          actual_progress: Math.round(actualProgress * 100),
          gap: Math.round(progressGap * 100),
          completed_steps: completedSteps,
          total_steps: steps.length
        });
      }
    }

    // Send notifications via OneSignal
    for (const notif of notificationsToSend) {
      try {
        const message = `You're doing great on "${notif.goal_title}"! You're currently at ${notif.actual_progress}% progress. Let's pick up the pace a bit—you've got this! 💪`;
        await base44.functions.invoke('sendOneSignalPush', {
          recipient_email: notif.user_email,
          title: 'Keep the momentum going!',
          message: message,
          data: { goal_id: notif.goal_id }
        });
      } catch (err) {
        console.error(`Failed to send notification for goal ${notif.goal_id}:`, err.message);
      }
    }

    return Response.json({
      checked_goals: goals.length,
      notifications_sent: notificationsToSend.length,
      details: notificationsToSend
    });
  } catch (error) {
    console.error('Error in checkGoalPace:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});