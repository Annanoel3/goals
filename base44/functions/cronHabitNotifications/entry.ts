/**
 * Runs daily — re-schedules next-day habit notifications for all active daily habit steps.
 * This ensures each habit gets exactly ONE push notification per day at the right time.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Validate secret header for cron security
    const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization');
    const expectedSecret = Deno.env.get('SCHEDULER_SECRET');
    if (expectedSecret && secret !== expectedSecret && secret !== `Bearer ${expectedSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const appId = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();
    const today = new Date().toISOString().split('T')[0];
    let scheduled = 0;
    let errors = 0;

    // Get all active daily habit steps
    const allSteps = await base44.asServiceRole.entities.GoalStep.filter({ is_daily_habit: true });
    const activeSteps = allSteps.filter(s => s.habit_time && s.status !== 'completed' && s.status !== 'skipped');

    for (const step of activeSteps) {
      try {
        // Get user info for player IDs
        const users = await base44.asServiceRole.entities.User.filter({ email: step.created_by });
        const user = users[0];
        if (!user || !user.onesignal_player_ids?.length) continue;

        const [hour, minute] = step.habit_time.split(':').map(Number);

        // Schedule for tomorrow at the habit time (UTC — habits store in UTC)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setUTCHours(hour, minute, 0, 0);

        const msg = getMessageForHabit(step.title);

        const notificationPayload = {
          app_id: appId,
          include_player_ids: user.onesignal_player_ids,
          headings: { en: msg.title },
          contents: { en: msg.body },
          send_after: tomorrow.toISOString(),
          data: {
            screen: '/Goals',
            type: 'habit_checkin',
            step_id: step.id,
            goal_id: step.goal_id
          }
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
        if (!result.errors) {
          // Mark check-in as pending (they'll get the notif tomorrow)
          await base44.asServiceRole.entities.GoalStep.update(step.id, {
            habit_checkin_pending: true,
            habit_notification_id: result.id || step.habit_notification_id
          });
          scheduled++;
        } else {
          errors++;
        }
      } catch (_) {
        errors++;
      }
    }

    return Response.json({ success: true, scheduled, errors, today });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});