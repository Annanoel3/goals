import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

async function generateHabitNotificationMessage(openai, step, goal, dayOfWeek, context) {
  // Use GPT-4o to generate personalized, contextual messages
  // dayOfWeek: 0 = Monday (start of week), 6 = Sunday (end of week)
  
  const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayOfWeek];
  const isEarlyWeek = dayOfWeek <= 2; // Mon-Wed
  const isLateWeek = dayOfWeek >= 4; // Fri-Sun
  const weekPhase = isEarlyWeek ? 'early week kickoff' : isLateWeek ? 'late week push' : 'mid-week momentum';
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You generate a single, brief push notification (2 parts: title + body) for a daily habit reminder. 
Output JSON only: {"title": "...", "body": "..."}
Rules:
- Title: max 5 words, one emoji, energetic but genuine
- Body: max 1-2 sentences, conversational, speaks to ${weekPhase}
- Personalize to: goal="${goal.title}", step="${step.title}", phase=${step.phase || 'ongoing'}, day=${dayName}
- NO generic motivation; be specific to their exact habit
- If it's ${dayOfWeek} (${dayName}), acknowledge where they are in their week
- NO SPOILERS: never reference plot points, events, or endings beyond where the reader currently is — keep it about showing up to the habit, not revealing content`
      },
      {
        role: "user",
        content: `Habit: "${step.title}"\nGoal: "${goal.title}"\nDescription: "${context}"\nDay of week: ${dayName} (weekday ${dayOfWeek})\nWeek phase: ${weekPhase}`
      }
    ]
  });
  
  const result = JSON.parse(response.choices[0].message.content);
  return result;
}

async function generateMissedHabitNotification(openai, step, goal, context) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You generate a compassionate "missed habit" follow-up notification. Output JSON only: {"title": "...", "body": "..."}
- Title: max 4 words, one emoji, supportive not judgmental
- Body: 1-2 sentences, acknowledge they missed it, encourage restart without guilt
- Be specific to their habit`
      },
      {
        role: "user",
        content: `Habit: "${step.title}"\nGoal: "${goal.title}"\nDescription: "${context}"\nThey missed this yesterday.`
      }
    ]
  });
  
  return JSON.parse(response.choices[0].message.content);
}

async function generateThreeDayMissNotification(openai, step, goal, context) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You generate a 3+ day habit miss notification that's supportive and offers recalibration. Output JSON only: {"title": "...", "body": "..."}
- Title: max 5 words, one emoji, calm and helpful
- Body: 2 sentences max, acknowledge streak break, offer path forward without judgment
- Reference the planner chat as a tool to adjust`
      },
      {
        role: "user",
        content: `Habit: "${step.title}"\nGoal: "${goal.title}"\nDescription: "${context}"\nThey've missed this for 3+ days.`
      }
    ]
  });
  
  return JSON.parse(response.choices[0].message.content);
}

function buildSendAtISO(habitTime, userTimezoneOffsetMinutes = 0) {
  let hour = 9, minute = 0;
  const _tp = String(habitTime).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (_tp) { hour = parseInt(_tp[1]); minute = parseInt(_tp[2]); if (_tp[3]) { const _pm = _tp[3].toUpperCase() === 'PM'; if (_pm && hour < 12) hour += 12; if (!_pm && hour === 12) hour = 0; } }
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

async function scheduleHabitNotificationForUser(base44, step, userEmail, timezoneOffset = 0, goal = null, openai = null) {
   if (!step.is_daily_habit) return;
   if (!openai) openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

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
      const msg = await generateHabitNotificationMessage(openai, step, goal, dayOfWeek, displayTitle);
      const sendAt = buildSendAtISO(step.habit_time || goal?.preferred_time || '09:00', timezoneOffset);

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

     const missedMsg = await generateMissedHabitNotification(openai, step, goal, displayTitle);
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
  if (consecutiveMissed >= 3 && !hasThreeDayNotificationToday) {
    const phaseMonthMatch3 = step.phase?.match(/Month\s+(\d+)/i);
    const currentMonth = phaseMonthMatch3 ? parseInt(phaseMonthMatch3[1]) : null;
    const monthTitle = currentMonth && goal?.month_titles && goal.month_titles[currentMonth] 
      ? goal.month_titles[currentMonth] 
      : null;
    const displayTitle = monthTitle || step.description || step.title;

    const threeMsg = await generateThreeDayMissNotification(openai, step, goal, displayTitle);
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
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
    
    // Get all active goals with habit steps
    const allGoals = await base44.asServiceRole.entities.Goal.filter({ status: 'active' });
    let scheduledCount = 0;

    for (const goal of allGoals) {
      try {
       const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
       const _todayStr = new Date().toISOString().split('T')[0];
       const _cands = steps
         .filter(s => s.is_daily_habit && s.status !== 'completed' && s.due_date)
         .sort((a, b) => a.due_date.localeCompare(b.due_date));
       // Current week = the latest step whose week has actually STARTED (due on/before today).
       // No fallback to a not-yet-started step → a future-start goal stays silent until it begins.
       let _current = null;
       for (const s of _cands) { if (s.due_date <= _todayStr) _current = s; }
       let habitSteps = [];
       if (_current) {
         const _cp = (_current.phase || '').match(/Month\s*(\d+)[,\s]+Week\s*(\d+)/i);
         const _isWeek1 = _cp && parseInt(_cp[1]) === 1 && parseInt(_cp[2]) === 1;
         // Skip Week 1 ONLY if scheduleGoalNotifications already scheduled it at creation. If it
         // couldn't (Week 1 past the 30-day window, or a far-future start), the flag is false and
         // the cron owns Week 1 too — scheduling it day-by-day now that it's in range.
         const _week1Done = goal.week1_notifications_scheduled === true;
         if (!(_isWeek1 && _week1Done)) habitSteps = [_current];
       }

       if (habitSteps.length > 0) {
         const user = (await base44.asServiceRole.entities.User.filter({ id: goal.created_by_id }))[0];
         if (user) {
           const timezoneOffset = goal.timezone_offset_minutes ?? 0;

           for (const step of habitSteps) {
             await scheduleHabitNotificationForUser(base44, step, user.email, timezoneOffset, goal, openai);
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