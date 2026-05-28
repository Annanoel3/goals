import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Personality-driven habit notification messages
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
  // habitTime is "HH:MM" in user's local time
  const [hour, minute] = habitTime.split(':').map(Number);
  const now = new Date();
  
  // Create today's send time in UTC by adjusting for user timezone offset
  const candidate = new Date(now);
  candidate.setUTCHours(hour, minute, 0, 0);
  // Shift from local → UTC
  candidate.setTime(candidate.getTime() - userTimezoneOffsetMinutes * 60 * 1000);

  // If that time has already passed today, schedule for tomorrow
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { stepId, habitTime, timezoneOffsetMinutes } = await req.json();
    if (!stepId || !habitTime) return Response.json({ error: 'stepId and habitTime required' }, { status: 400 });

    // Get step directly by ID
    const step = await base44.entities.GoalStep.get(stepId);
    if (!step) return Response.json({ error: 'Step not found' }, { status: 404 });

    // Cancel previous notification if any
    if (step.habit_notification_id) {
      try {
        const appId = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
        const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();
        await fetch(`https://onesignal.com/api/v1/notifications/${step.habit_notification_id}?app_id=${appId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Basic ${restApiKey}` }
        });
      } catch (_) { /* best effort */ }
    }

    const msg = getMessageForHabit(step.title);
    const sendAt = buildSendAtISO(habitTime, timezoneOffsetMinutes || 0);

    const appId = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

    const notificationPayload = {
      app_id: appId,
      include_aliases: [{ alias_label: 'external_id', alias_value: user.email }],
      target_channel: 'push',
      headings: { en: msg.title },
      contents: { en: msg.body },
      send_after: sendAt,
      data: {
        screen: '/Goals',
        type: 'habit_checkin',
        step_id: stepId,
        goal_id: step.goal_id
      },
    };

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${restApiKey}`
      },
      body: JSON.stringify(notificationPayload)
    });

    const result = await response.json();
    if (result.errors) {
      return Response.json({ error: result.errors }, { status: 500 });
    }

    // Save to step
    await base44.entities.GoalStep.update(stepId, {
      is_daily_habit: true,
      habit_time: habitTime,
      habit_notification_id: result.id || null
    });

    // Also save timezone offset on the user profile for future cron runs to use
    const currentUser = await base44.auth.me();
    if (currentUser && timezoneOffsetMinutes !== undefined) {
      try {
        await base44.auth.updateMe({ timezone_offset: timezoneOffsetMinutes });
      } catch (_) { /* best effort */ }
    }

    return Response.json({ success: true, notificationId: result.id, sendAt });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});