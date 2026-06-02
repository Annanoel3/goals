import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all active health goals with preferred times
    const healthGoals = await base44.asServiceRole.entities.Goal.filter({
      category: 'health',
      status: 'active'
    });

    const now = new Date();
    const results = [];

    for (const goal of healthGoals) {
      if (!goal.preferred_time) continue;

      // Parse preferred time (e.g., "6:00 AM", "18:30")
      const timeMatch = goal.preferred_time.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
      if (!timeMatch) continue;

      let hour = parseInt(timeMatch[1]);
      const minute = parseInt(timeMatch[2] || 0);
      const meridiem = timeMatch[3]?.toLowerCase();

      // Convert to 24-hour format
      if (meridiem === 'pm' && hour !== 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;

      // Calculate scheduled time today
      const scheduledTime = new Date();
      scheduledTime.setHours(hour, minute, 0, 0);

      // Calculate follow-up time (2 hours later by default)
      const followUpTime = new Date(scheduledTime);
      const interval = goal.reminder_interval || '2hours';
      const minutes = interval === '15min' ? 15 : interval === '30min' ? 30 : interval === '1hour' ? 60 : 120;
      followUpTime.setMinutes(followUpTime.getMinutes() + minutes);

      // Check if we're past the follow-up time and goal steps aren't all completed
      if (now >= followUpTime) {
        // Get goal steps for today
        const goalSteps = await base44.asServiceRole.entities.GoalStep.filter({
          goal_id: goal.id,
          status: { '$ne': 'completed' }
        });

        // Check if any steps were completed recently (within last hour)
        let hasRecentActivity = false;
        for (const step of goalSteps) {
          if (step.completed_at) {
            const completedTime = new Date(step.completed_at);
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            if (completedTime > hourAgo) {
              hasRecentActivity = true;
              break;
            }
          }
        }

        // Only send follow-up if no recent activity
        if (!hasRecentActivity && goalSteps.length > 0) {
          const user = await base44.asServiceRole.entities.User.list().then(users =>
            users.find(u => u.id === goal.created_by)
          );

          if (user?.email) {
            // Send reminder via OneSignal push
            try {
              await fetch('https://onesignal.com/api/v1/notifications', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Basic ${Deno.env.get('ONESIGNAL_REST_API_KEY')}`
                },
                body: JSON.stringify({
                  app_id: Deno.env.get('ONESIGNAL_APP_ID'),
                  include_external_user_ids: [user.email],
                  channel_for_external_user_ids: 'push',
                  headings: { en: `⏰ Still working on "${goal.title}"?` },
                  contents: { en: `You scheduled a workout for ${goal.preferred_time}, but we haven't seen any activity yet. Tap to check in!` },
                  data: { goal_id: goal.id, screen: 'GoalStepNotification' }
                })
              });

              results.push({
                goal_id: goal.id,
                goal_title: goal.title,
                status: 'reminder_sent',
                sent_to: user.email
              });
            } catch (err) {
              results.push({
                goal_id: goal.id,
                goal_title: goal.title,
                status: 'error',
                error: err.message
              });
            }
          }
        }
      }
    }

    return Response.json({ processed: results.length, results });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});