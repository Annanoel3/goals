import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

function getMessageForHabit(stepTitle, stepDescription, dayOfWeek) {
  // dayOfWeek: 0 = Monday (start of week), 6 = Sunday (end of week)
  // Use description if available, fall back to title
  const context = stepDescription || stepTitle;
  const lower = context.toLowerCase();
  const isEarlyWeek = dayOfWeek <= 2; // Mon-Wed
  const isLateWeek = dayOfWeek >= 4; // Fri-Sun
  
  // Extract key action from description (e.g., "read 25% of a book" → "read")
  const action = extractAction(context);
  
  // Generate contextual message based on timing in the week
  if (isEarlyWeek) {
    // Start of week: encourage getting started
    return {
      title: "🚀 Let's kick this off!",
      body: `Have you started ${action} today? This is your moment. Let's do this! 💪`
    };
  } else if (isLateWeek) {
    // End of week: push for completion
    return {
      title: "📈 Almost there!",
      body: `Are you on track with "${context}"? Push through today — you've got this! 🔥`
    };
  } else {
    // Mid-week: keep momentum
    return {
      title: "⏰ Steady progress!",
      body: `Keep the momentum going with "${action}". You're doing great! 🌟`
    };
  }
}

function extractAction(text) {
  // Extract action verb from description
  // E.g., "read 25% of a book" → "read 25% of a book"
  // E.g., "complete a workout" → "complete a workout"
  const words = text.toLowerCase().split(' ');
  if (words.length > 1) {
    return text.substring(0, 40) + (text.length > 40 ? '...' : '');
  }
  return text;
}

function buildSendAtISO(habitTime, userTimezoneOffsetMinutes = 0) {
  const [hour, minute] = habitTime.split(':').map(Number);
  const now = new Date();
  
  const candidate = new Date(now);
  candidate.setUTCHours(hour, minute, 0, 0);
  candidate.setTime(candidate.getTime() - userTimezoneOffsetMinutes * 60 * 1000);

  // Always schedule for tomorrow (or today if time hasn't passed)
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

async function scheduleHabitNotificationForUser(base44, step, userEmail, timezoneOffset = 0) {
  if (!step.habit_time || !step.is_daily_habit) return;

  // Check if we already scheduled a notification for today
  const today = new Date().toISOString().split('T')[0];
  if (step.last_habit_notification_date === today) {
    return; // Already scheduled for today
  }

  // Cancel old notification if exists
  if (step.habit_notification_id) {
    try {
      await fetch(`https://onesignal.com/api/v1/notifications/${step.habit_notification_id}?app_id=${ONESIGNAL_APP_ID}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` }
      });
    } catch (_) { /* best effort */ }
  }

  // Determine day of week for contextual messaging
  const sendAtDate = new Date();
  const dayOfWeek = sendAtDate.getDay();

  const msg = getMessageForHabit(step.title, step.description, dayOfWeek);
  const sendAt = buildSendAtISO(step.habit_time, timezoneOffset);

  const notificationPayload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [userEmail] },
    target_channel: 'push',
    headings: { en: msg.title },
    contents: { en: msg.body },
    send_after: sendAt,
    data: {
      screen: '/Goals',
      type: 'habit_checkin',
      step_id: step.id,
      goal_id: step.goal_id
    },
  };

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(notificationPayload)
    });

    const result = await response.json();
    if (result.id) {
      // Save the new notification ID and today's date to prevent duplicates
      await base44.asServiceRole.entities.GoalStep.update(step.id, {
        habit_notification_id: result.id,
        last_habit_notification_date: today
      });
    }
  } catch (err) {
    console.error(`Failed to schedule habit notification for step ${step.id}:`, err.message);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all active goals with habit steps
    const allGoals = await base44.asServiceRole.entities.Goal.filter({ status: 'active' });
    let scheduledCount = 0;

    for (const goal of allGoals) {
      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const habitSteps = steps.filter(s => s.is_daily_habit && s.habit_time && s.status !== 'completed');

      if (habitSteps.length > 0) {
        const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
        if (user) {
          // Estimate timezone offset from user profile if available, default to 0 (UTC)
          const timezoneOffset = user.timezone_offset || 0;

          for (const step of habitSteps) {
            await scheduleHabitNotificationForUser(base44, step, user.email, timezoneOffset);
            scheduledCount++;
          }
        }
      }
    }

    return Response.json({ ok: true, scheduled: scheduledCount });
  } catch (err) {
    console.error('Error in cronDailyHabitNotifications:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});