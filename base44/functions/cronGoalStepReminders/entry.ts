import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const steps = await base44.asServiceRole.entities.GoalStep.list();

    // Find overdue steps that have no pending notification IDs
    const overdueSteps = steps.filter(step => {
      return step.due_date &&
             new Date(step.due_date) < now &&
             step.status !== 'completed' &&
             step.status !== 'skipped' &&
             !(step.onesignal_notification_ids?.length > 0);
    });

    const results = [];

    for (const step of overdueSteps) {
      const goalResults = await base44.asServiceRole.entities.Goal.filter({ id: step.goal_id });
      const goal = goalResults[0];
      if (!goal) continue;

      // One notification per goal per day (cross-cron dedup)
      const todayStr = new Date().toISOString().split('T')[0];
      if (goal.last_cron_notification_date === todayStr) continue;

      // Look up user by email (created_by stores email)
      const users = await base44.asServiceRole.entities.User.filter({ email: goal.created_by });
      const user = users[0];
      if (!user) continue;

      // Use external user ID (email) for targeting
      const externalId = user.email;

      const payload = {
        app_id: ONESIGNAL_APP_ID,
        include_aliases: { external_id: [String(externalId)] },
        target_channel: 'push',
        headings: { en: `${step.title} is overdue` },
        contents: { en: `You have a step overdue in "${goal.title}". Tap to reschedule or mark complete.` },
        data: {
          screen: 'GoalStepNotification',
          action: 'goal_step_followup',
          step_id: step.id,
          goal_id: goal.id,
        },
      };

      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      const notificationData = await response.json();
      // OneSignal returns { id: "..." } on success
      const notificationId = notificationData.id;

      if (notificationId) {
        await base44.asServiceRole.entities.GoalStep.update(step.id, {
          onesignal_notification_ids: [notificationId]
        });
        // Mark goal as notified today (cross-cron dedup)
        await base44.asServiceRole.entities.Goal.update(goal.id, {
          last_cron_notification_date: todayStr,
        });
        // Store pending notification for in-app popup on next app open
        try {
          await base44.asServiceRole.entities.Goal.update(goal.id, {
            pending_notification: {
              title: `${step.title} is overdue`,
              body: `You have a step overdue in "${goal.title}". Tap to reschedule or mark complete.`,
              action: 'goal_step_followup',
              goal_id: goal.id,
              step_id: step.id,
              nudge_message: null,
              stored_at: new Date().toISOString()
            }
          });
        } catch (_) { /* best effort */ }
        results.push({ step_id: step.id, notified: true });
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