import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Get all goals
    const goals = await base44.asServiceRole.entities.Goal.list();
    const results = [];

    const todayStr = new Date().toISOString().split('T')[0];

    for (const goal of goals) {
      if (goal.status !== 'active') continue;

      // One notification per goal per day (cross-cron dedup)
      if (goal.last_cron_notification_date === todayStr) continue;

      // Get all steps for this goal, grouped by phase
      const steps = await base44.asServiceRole.entities.GoalStep.filter({
        goal_id: goal.id
      });

      // Group steps by phase
      const phaseMap = {};
      steps.forEach(step => {
        const phase = step.phase || 'unphased';
        if (!phaseMap[phase]) {
          phaseMap[phase] = [];
        }
        phaseMap[phase].push(step);
      });

      // Check each phase (milestone) for completion
      for (const [phase, phaseSteps] of Object.entries(phaseMap)) {
        const allCompleted = phaseSteps.every(s => s.status === 'completed' || s.status === 'skipped');
        const anyPending = phaseSteps.some(s => s.status === 'pending' || s.status === 'in_progress');

        if (allCompleted || !anyPending) {
          // This milestone is either done or about to be done
          // Find earliest due date in this phase
          const upcomingStep = phaseSteps
            .filter(s => s.status !== 'completed' && s.status !== 'skipped')
            .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];

          if (upcomingStep) {
            const dueDate = new Date(upcomingStep.due_date);
            
            // Check if due date is tomorrow (24h ahead)
            if (dueDate >= now && dueDate <= tomorrow) {
              // Look up user by ID (Goal entity stores created_by_id = user ID)
              const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
              if (!user) continue;

              const payload = {
                app_id: ONESIGNAL_APP_ID,
                include_aliases: { external_id: [String(user.email)] },
                target_channel: 'push',
                headings: { en: `Big milestone coming! 🎉` },
                contents: { en: `"${goal.title}" - ${phase} is almost done. You're so close!` },
                data: {
                  screen: 'GoalStepNotification',
                  goal_id: goal.id,
                  action: 'milestone_upcoming',
                  phase
                }
              };

              const response = await fetch('https://onesignal.com/api/v1/notifications', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
                },
                body: JSON.stringify(payload)
              });

              if (response.ok) {
                // Mark goal as notified today (cross-cron dedup)
                await base44.asServiceRole.entities.Goal.update(goal.id, {
                  last_cron_notification_date: todayStr,
                });
                // Store pending notification for in-app popup on next app open
                try {
                  await base44.asServiceRole.entities.Goal.update(goal.id, {
                    pending_notification: {
                      title: `Big milestone coming! 🎉`,
                      body: `"${goal.title}" - ${phase} is almost done. You're so close!`,
                      action: 'milestone_upcoming',
                      goal_id: goal.id,
                      step_id: null,
                      nudge_message: null,
                      stored_at: new Date().toISOString()
                    }
                  });
                } catch (_) { /* best effort */ }
                results.push({
                  goal_id: goal.id,
                  phase,
                  notified: true
                });
              }
            }
          }
        }
      }
    }

    return Response.json({ 
      success: true, 
      processed: results.length,
      results 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});