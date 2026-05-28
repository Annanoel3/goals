import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

const habitMessages = {
  affirmation: [
    { title: "🌅 Morning magic time!", body: "Your affirmations are waiting. 2 minutes now = a whole different day. You in? 💪" },
    { title: "✨ This is your moment", body: "The most powerful thing you'll do today takes 2 minutes. Let's go! 🌟" },
    { title: "🔥 Wake up your inner champion", body: "Those affirmations won't say themselves! Your future self is counting on you. 💫" },
  ],
  meditation: [
    { title: "🧘 Your calm is calling", body: "Just 5 minutes of stillness = a superpower for the whole day. Ready? 🌿" },
    { title: "🌊 Breathe in, tune in", body: "The world can wait 5 minutes. Your mind deserves this. Sit down, let's go! ✨" },
    { title: "💆 Mental reset time!", body: "Hit pause on life for a sec. Your meditation session is ready and waiting. 🧠" },
  ],
  journal: [
    { title: "📓 Brain dump o'clock!", body: "Your journal is judging you (kidding 😄). 5 minutes of writing = clarity all day!" },
    { title: "✍️ Time to spill the tea — to yourself", body: "What's on your mind? Write it down. You'll thank yourself later. 📝" },
    { title: "💭 Thoughts need a home!", body: "Get them out of your head and onto paper. Your journal is open and ready! 🌸" },
  ],
  exercise: [
    { title: "💪 Move it, move it!", body: "Your body called — it wants a workout. No negotiations, let's GO! 🏃" },
    { title: "🔥 Time to sweat!", body: "Future you is already proud. Your workout is waiting — no excuses today! 💥" },
    { title: "⚡ Energy boost incoming!", body: "Every rep is a vote for the person you're becoming. Time to vote! 🏋️" },
  ],
  reading: [
    { title: "📚 Book o'clock!", body: "Your reading session is waiting. Dive in — even 10 pages changes your brain! 🧠" },
    { title: "📖 Wisdom is calling", body: "The smartest version of you is one reading session away. Let's go! ✨" },
    { title: "🌟 Power hour: reading edition", body: "Turn off the noise, open the book. This is YOUR time! 📚" },
  ],
  default: [
    { title: "⏰ Habit check-in!", body: "Time to work on your goal. Small steps today = big results tomorrow. You've got this! 💪" },
    { title: "🎯 Your daily habit is calling", body: "Consistency is your superpower. Show up today — future you will be so grateful! ✨" },
    { title: "🌟 Time to level up!", body: "Every day you show up is a win. Today's your day — let's do this! 🔥" },
  ]
};

function getMessageForHabit(title) {
  const lower = title.toLowerCase();
  let category = 'default';
  if (lower.includes('affirm') || lower.includes('mantra')) category = 'affirmation';
  else if (lower.includes('meditat') || lower.includes('mindful') || lower.includes('breathe') || lower.includes('breathing')) category = 'meditation';
  else if (lower.includes('journal') || lower.includes('gratitude') || lower.includes('write') || lower.includes('writing') || lower.includes('diary')) category = 'journal';
  else if (lower.includes('exercise') || lower.includes('workout') || lower.includes('run') || lower.includes('gym') || lower.includes('yoga') || lower.includes('walk')) category = 'exercise';
  else if (lower.includes('read') || lower.includes('book') || lower.includes('study')) category = 'reading';

  const messages = habitMessages[category];
  return messages[Math.floor(Math.random() * messages.length)];
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

  const msg = getMessageForHabit(step.title);
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
      // Save the new notification ID
      await base44.asServiceRole.entities.GoalStep.update(step.id, {
        habit_notification_id: result.id
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