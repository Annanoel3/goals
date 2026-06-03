import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function buildSendAtISO(habitTime, userTimezoneOffsetMinutes = 0) {
  const [hour, minute] = habitTime.split(':').map(Number);
  const now = new Date();
  
  const candidate = new Date(now);
  candidate.setUTCHours(hour, minute, 0, 0);
  candidate.setTime(candidate.getTime() - userTimezoneOffsetMinutes * 60 * 1000);

  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id, user_email } = await req.json();

    let user;
    let goalsToProcess = [];

    if (goal_id) {
      const goal = await base44.asServiceRole.entities.Goal.get(goal_id);
      if (goal) {
        goalsToProcess.push(goal);
        user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
      }
    } else if (user_email) {
      const userList = await base44.asServiceRole.entities.User.filter({ email: user_email });
      if (userList && userList.length > 0) {
        user = userList[0];
        goalsToProcess = await base44.asServiceRole.entities.Goal.filter({ created_by_id: user.id, status: 'active' });
      }
    }

    if (!user) {
      return Response.json({ error: 'User not found or not provided' }, { status: 400 });
    }

    let scheduledCount = 0;
    const timezoneOffset = user.timezone_offset || 0;
    const userEmailAddr = user.email;

    for (const goal of goalsToProcess) {
      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const habitSteps = steps.filter(s => s.is_daily_habit && s.habit_time && s.status !== 'completed');

      for (const step of habitSteps) {
        const sendAtISO = buildSendAtISO(step.habit_time, timezoneOffset);
        
        // Build personalized message
        const title = `🎯 ${step.title}`;
        const message = `Time for your habit from ${goal.title}: ${step.description || step.title}. You've got this! 💪`;
        
        const result = await base44.asServiceRole.functions.invoke('sendOneSignalPush', {
          userEmail: userEmailAddr,
          title: title,
          message: message,
          sendAtISO: sendAtISO,
          data: { screen: 'Goals', type: 'habit_reminder', goal_id: goal.id, step_id: step.id },
        });

        if (result?.data?.success) {
          scheduledCount++;
        }
      }
    }

    return Response.json({ ok: true, scheduled: scheduledCount });
  } catch (err) {
    console.error('Error in scheduleHabitNotifications:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});