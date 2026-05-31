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

function getMissedHabitMessage(stepTitle, stepDescription) {
  const context = stepDescription || stepTitle;
  return {
    title: "🙌 Let's get back on track",
    body: `I noticed you missed your "${context}" yesterday, but don't worry. You can do this! Let's go. 💪`
  };
}

function getThreeDayMissMessage(stepTitle, stepDescription) {
  const context = stepDescription || stepTitle;
  return {
    title: "⏸️ Let's recalibrate",
    body: `It looks like you've missed "${context}" for a few days. That's okay! Use the planner chat to adjust your plan if you need to, or keep up the great work catching up. I know you can do this! 💪`
  };
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

function buildMissedHabitSendAtISO(userTimezoneOffsetMinutes = 0) {
  // Schedule missed habit notification for 10 AM today (or tomorrow if past 10 AM)
  const now = new Date();
  
  const candidate = new Date(now);
  candidate.setUTCHours(10, 0, 0, 0);
  candidate.setTime(candidate.getTime() - userTimezoneOffsetMinutes * 60 * 1000);

  // If 10 AM has already passed today, schedule for tomorrow
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

function getConsecutiveMissedDays(step) {
  // Count consecutive missed days from today backwards
  const today = new Date();
  let missedDays = 0;
  
  for (let i = 0; i < 10; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split('T')[0];
    
    if (!step.habit_completions || !step.habit_completions.includes(dateStr)) {
      missedDays++;
    } else {
      break;
    }
  }
  
  return missedDays;
}

async function scheduleHabitNotificationForUser(base44, step, userEmail, timezoneOffset = 0, goal = null) {
   if (!step.habit_time || !step.is_daily_habit) return;

   const today = new Date().toISOString().split('T')[0];

   // 1. Schedule today's regular habit reminder
   if (step.last_habit_notification_date !== today) {
     // Cancel old notification if exists
     if (step.habit_notification_id) {
       try {
         await fetch(`https://onesignal.com/api/v1/notifications/${step.habit_notification_id}?app_id=${ONESIGNAL_APP_ID}`, {
           method: 'DELETE',
           headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` }
         });
       } catch (_) { /* best effort */ }
     }

     const sendAtDate = new Date();
     const dayOfWeek = sendAtDate.getDay();

     // Get current month number (1-indexed) for month_titles lookup
     // Derive plan month from step.phase (e.g. "Month 2 Week 3" -> 2)
    const phaseMonthMatch = step.phase?.match(/Month\s+(\d+)/i);
    const currentMonth = phaseMonthMatch ? parseInt(phaseMonthMatch[1]) : null;
     const monthTitle = currentMonth && goal?.month_titles && goal.month_titles[currentMonth] 
       ? goal.month_titles[currentMonth] 
       : null;

     // Use month-specific title if available, otherwise fall back to step description
     const displayTitle = monthTitle || step.description || step.title;
     const msg = getMessageForHabit(step.title, displayTitle, dayOfWeek);
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
        await base44.asServiceRole.entities.GoalStep.update(step.id, {
          habit_notification_id: result.id,
          last_habit_notification_date: today
        });
      }
    } catch (err) {
      console.error(`Failed to schedule habit notification for step ${step.id}:`, err.message);
    }
  }

  // 2. Check if habit was missed yesterday and schedule follow-up at 10 AM
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const wasCompletedYesterday = step.habit_completions && step.habit_completions.includes(yesterdayStr);
  const hasMissedNotificationToday = step.last_missed_notification_date === today;

  if (!wasCompletedYesterday && !hasMissedNotificationToday && step.last_habit_checkin_date !== yesterdayStr) {
    // Cancel old missed notification if exists
    if (step.missed_habit_notification_id) {
      try {
        await fetch(`https://onesignal.com/api/v1/notifications/${step.missed_habit_notification_id}?app_id=${ONESIGNAL_APP_ID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` }
        });
      } catch (_) { /* best effort */ }
    }

    // Derive plan month from step.phase (e.g. "Month 2 Week 3" -> 2)
    const phaseMonthMatch2 = step.phase?.match(/Month\s+(\d+)/i);
    const currentMonth = phaseMonthMatch2 ? parseInt(phaseMonthMatch2[1]) : null;
     const monthTitle = currentMonth && goal?.month_titles && goal.month_titles[currentMonth] 
       ? goal.month_titles[currentMonth] 
       : null;
     const displayTitle = monthTitle || step.description || step.title;

     const missedMsg = getMissedHabitMessage(step.title, displayTitle);
     const sendAtMissed = buildMissedHabitSendAtISO(timezoneOffset);

    const missedNotificationPayload = {
      app_id: ONESIGNAL_APP_ID,
      include_aliases: { external_id: [userEmail] },
      target_channel: 'push',
      headings: { en: missedMsg.title },
      contents: { en: missedMsg.body },
      send_after: sendAtMissed,
      data: {
        screen: '/Goals',
        type: 'habit_missed_followup',
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
        body: JSON.stringify(missedNotificationPayload)
      });

      const result = await response.json();
      if (result.id) {
        await base44.asServiceRole.entities.GoalStep.update(step.id, {
          missed_habit_notification_id: result.id,
          last_missed_notification_date: today
        });
      }
    } catch (err) {
      console.error(`Failed to schedule missed habit notification for step ${step.id}:`, err.message);
    }
  }

  // 3. Check if habit was missed 3+ days in a row and schedule check-in notification
  const consecutiveMissed = getConsecutiveMissedDays(step);
  const hasThreeDayNotificationToday = step.last_three_day_miss_notification_date === today;
// Derive plan month from step.phase (e.g. "Month 2 Week 3" -> 2)
    const phaseMonthMatch2 = step.phase?.match(/Month\s+(\d+)/i);
    const currentMonth = phaseMonthMatch2 ? parseInt(phaseMonthMatch2[1]) : null;
  if (consecutiveMissed >= 3 && !hasThreeDayNotificationToday) {
    const currentMonth = new Date().getMonth() + 1;
    const monthTitle = currentMonth && goal?.month_titles && goal.month_titles[currentMonth] 
      ? goal.month_titles[currentMonth] 
      : null;
    const displayTitle = monthTitle || step.description || step.title;

    const threeMsg = getThreeDayMissMessage(step.title, displayTitle);
    const sendAtThree = buildMissedHabitSendAtISO(timezoneOffset);

    const threeNotificationPayload = {
      app_id: ONESIGNAL_APP_ID,
      include_aliases: { external_id: [userEmail] },
      target_channel: 'push',
      headings: { en: threeMsg.title },
      contents: { en: threeMsg.body },
      send_after: sendAtThree,
      data: {
        screen: '/Goals',
        type: 'habit_three_day_miss',
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
        body: JSON.stringify(threeNotificationPayload)
      });

      const result = await response.json();
      if (result.id) {
        await base44.asServiceRole.entities.GoalStep.update(step.id, {
          last_three_day_miss_notification_date: today
        });
      }
    } catch (err) {
      console.error(`Failed to schedule 3-day miss notification for step ${step.id}:`, err.message);
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all active goals with habit steps
    const allGoals = await base44.asServiceRole.entities.Goal.filter({ status: 'active' });
    let scheduledCount = 0;

    for (const goal of allGoals) {
      try {
       const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
       const habitSteps = steps.filter(s => s.is_daily_habit && s.habit_time && s.status !== 'completed');

       if (habitSteps.length > 0) {
         const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
         if (user) {
           // Estimate timezone offset from user profile if available, default to 0 (UTC)
           const timezoneOffset = user.timezone_offset || 0;

           for (const step of habitSteps) {
             await scheduleHabitNotificationForUser(base44, step, user.email, timezoneOffset, goal);
             scheduledCount++;
           }
         }
       }
      } catch (goalErr) {
        console.error(`Skipping goal ${goal.id}:`, goalErr.message);
      }
    }

    return Response.json({ ok: true, scheduled: scheduledCount });
  } catch (err) {
    console.error('Error in cronDailyHabitNotifications:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});