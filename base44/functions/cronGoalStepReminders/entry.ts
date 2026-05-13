import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const secret = body.secret;

    if (secret !== Deno.env.get("SCHEDULER_SECRET")) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    const base44 = createClientFromRequest(req);

    // Get all overdue steps
    const now = new Date();
    const steps = await base44.asServiceRole.entities.GoalStep.list();
    
    const overdueSteps = steps.filter(step => {
      return step.due_date && 
             new Date(step.due_date) < now && 
             step.status !== 'completed' && 
             step.status !== 'skipped';
    });

    const results = [];

    for (const step of overdueSteps) {
      // Check if already notified recently
      const lastNotification = step.onesignal_notification_ids?.[step.onesignal_notification_ids.length - 1];
      if (lastNotification) {
        continue; // Already has pending notification
      }

      // Get parent goal for context
      const goal = await base44.asServiceRole.entities.Goal.get(step.goal_id);
      if (!goal) continue;

      // Use LLM to determine task complexity
      const complexityResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Analyze if this task is quick/small (< 1 hour) or big/multi-day (> 1 hour). Respond with only 'quick' or 'big'."
          },
          {
            role: "user",
            content: `Task: ${step.title}\nDescription: ${step.description || ''}\nGoal: ${goal.title}`
          }
        ]
      });

      const complexity = complexityResponse.choices[0].message.content.toLowerCase().includes('big') ? 'big' : 'quick';
      
      // Calculate delay: 1 day for big tasks, 1 hour for quick tasks
      const delayMs = complexity === 'big' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      const dueDate = new Date(step.due_date);
      const notificationTime = new Date(dueDate.getTime() + delayMs);

      // Only send if we're past the notification time
      if (now >= notificationTime) {
        // Get user email from goal
        const user = await base44.asServiceRole.entities.User.get(goal.created_by);
        if (!user) continue;

        // Schedule OneSignal notification with action buttons
        const payload = {
          include_external_user_ids: [user.email],
          headings: { en: `${step.title} is overdue` },
          contents: { en: `You have a step overdue in "${goal.title}". Tap to reschedule or mark complete.` },
          data: {
            step_id: step.id,
            goal_id: goal.id,
            action: 'step_overdue'
          },
          buttons: [
            {
              id: "done",
              text: "I've done this"
            },
            {
              id: "remind_later",
              text: "I need more time"
            }
          ]
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
          const notificationData = await response.json();
          const notificationId = notificationData.body?.notification_id;

          // Store notification ID
          if (notificationId) {
            const ids = step.onesignal_notification_ids || [];
            await base44.asServiceRole.entities.GoalStep.update(step.id, {
              onesignal_notification_ids: [...ids, notificationId]
            });
          }

          results.push({ step_id: step.id, notified: true, complexity });
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