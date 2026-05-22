import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

async function cancelNotification(notifId) {
  try {
    await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch (_) {}
}

async function scheduleNotification({ externalId, title, body, data, sendAt }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    headings: { en: title },
    contents: { en: body },
    data,
    channel_for_external_user_ids: 'push',
    send_after: sendAt,
    buttons: [
      { id: 'complete', text: "✅ Done" },
      { id: 'remind_later', text: "⏰ Remind Later" },
    ],
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return json?.id || null;
}

// Personalize daily notification message based on goal
function generateDailyMessage(goal, step) {
  const goalTitle = goal.title?.toLowerCase() || '';
  const stepTitle = step.title?.toLowerCase() || '';
  
  // Reading/Learning goals
  if (goalTitle.includes('read') || goalTitle.includes('learn') || stepTitle.includes('read')) {
    return `Have you done your reading for ${goal.title} today? Every page counts! 📖`;
  }
  // Fitness/Exercise goals
  if (goalTitle.includes('exercise') || goalTitle.includes('workout') || goalTitle.includes('fitness') || goalTitle.includes('steps')) {
    return `Time to move! Have you gotten your activity in for ${goal.title} today? 💪`;
  }
  // Meditation/Mindfulness goals
  if (goalTitle.includes('meditat') || goalTitle.includes('mindful') || stepTitle.includes('meditat')) {
    return `Take a moment for yourself. Time for your ${goal.title} practice? 🧘`;
  }
  // Health/Nutrition goals
  if (goalTitle.includes('health') || goalTitle.includes('nutrition') || goalTitle.includes('diet')) {
    return `Staying on track with ${goal.title}! What are you eating today? 🥗`;
  }
  // Creative goals
  if (goalTitle.includes('write') || goalTitle.includes('art') || goalTitle.includes('music') || goalTitle.includes('creative')) {
    return `Let's make something! Time to work on ${goal.title}? 🎨`;
  }
  // Default personalized message
  return `Time to work on ${goal.title}! You've got this! ⭐`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { goal_id } = body;
    if (!goal_id) return Response.json({ error: 'Missing goal_id' }, { status: 400 });

    const goalResults = await base44.entities.Goal.filter({ id: goal_id });
    const goal = goalResults[0];
    if (!goal) return Response.json({ error: 'Entity Goal with ID ' + goal_id + ' not found' }, { status: 404 });

    const steps = await base44.entities.GoalStep.filter({ goal_id });
    const externalId = user.email;
    const now = new Date();

    let scheduled = 0;
    let cancelled = 0;

    // Get user's preferred notification time (default 10 AM)
    let prefHour = 10;
    let prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) {
        prefHour = parseInt(tp[1]);
        prefMin = parseInt(tp[2]);
      }
    }

    for (const step of steps) {
      // Cancel any existing notifications for this step
      const existingIds = step.onesignal_notification_ids || [];
      if (existingIds.length > 0) {
        for (const nid of existingIds) {
          await cancelNotification(nid);
          cancelled++;
        }
      }

      const newNotifIds = [];

      if (step.is_daily_habit) {
        // ── DAILY HABIT STEPS ───────────────────────────────────────────────
        // Schedule a daily notification for the next 30 days starting from
        // the step's due_date (or today if no due_date), stopping at the goal's target_date.
        const startDate = step.due_date ? new Date(step.due_date + 'T00:00:00Z') : now;
        // If start is in the past, start from tomorrow
        const habitStart = startDate < now
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          : startDate;

        const goalEnd = goal.target_date
          ? new Date(goal.target_date + 'T23:59:59Z')
          : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // default 90 days

        // Use step habit_time, goal preferred_time, or user's global preferred time
        let notifHour = prefHour;
        let notifMin = prefMin;
        const timeStr = step.habit_time || goal.preferred_time;
        if (timeStr) {
          const tp = timeStr.match(/(\d{1,2}):(\d{2})/);
          if (tp) { notifHour = parseInt(tp[1]); notifMin = parseInt(tp[2]); }
          else {
            const ampm = timeStr.match(/(\d{1,2})\s*(am|pm)/i);
            if (ampm) {
              notifHour = parseInt(ampm[1]);
              if (ampm[2].toLowerCase() === 'pm' && notifHour !== 12) notifHour += 12;
              if (ampm[2].toLowerCase() === 'am' && notifHour === 12) notifHour = 0;
            }
          }
        }

        // Schedule daily reminders for every day until goal end
        let d = new Date(habitStart);
        while (d <= goalEnd) {
          const sendAt = new Date(d);
          sendAt.setUTCHours(notifHour, notifMin, 0, 0);
          if (sendAt > now) {
            const nid = await scheduleNotification({
              externalId,
              title: `Daily check-in`,
              body: generateDailyMessage(goal, step),
              data: {
                screen: 'GoalStepNotification',
                action: 'habit_checkin',
                goal_id: goal.id,
                step_id: step.id,
              },
              sendAt: sendAt.toISOString(),
            });
            if (nid) { newNotifIds.push(nid); scheduled++; }
          }
          d.setDate(d.getDate() + 1);
        }

        // Schedule weekly summaries (Sunday 8pm - beginning of week)
        let weekStart = new Date(habitStart);
        const dayOfWeek = weekStart.getDay();
        if (dayOfWeek !== 0) {
          weekStart.setDate(weekStart.getDate() + (7 - dayOfWeek));
        }
        while (weekStart <= goalEnd) {
          const summaryTime = new Date(weekStart);
          summaryTime.setUTCHours(20, 0, 0, 0); // 8 PM for week ahead
          if (summaryTime > now) {
            const weekNum = Math.ceil(((weekStart - habitStart) / (7 * 24 * 60 * 60 * 1000)) + 1);
            const nid = await scheduleNotification({
              externalId,
              title: `📅 Week ${weekNum} ahead`,
              body: `Check out what's coming up this week for "${goal.title}". Ready to crush it?`,
              data: {
                screen: 'GoalDetail',
                goal_id: goal.id,
                action: 'week_preview',
              },
              sendAt: summaryTime.toISOString(),
            });
            if (nid) { newNotifIds.push(nid); scheduled++; }
          }
          weekStart.setDate(weekStart.getDate() + 7);
        }

        // Schedule weekly recap (Friday 6pm - end of week)
        let weekEnd = new Date(habitStart);
        const dayOfWeekEnd = weekEnd.getDay();
        if (dayOfWeekEnd !== 5) {
          weekEnd.setDate(weekEnd.getDate() + (5 - dayOfWeekEnd + 7) % 7);
        }
        while (weekEnd <= goalEnd) {
          const recapTime = new Date(weekEnd);
          recapTime.setUTCHours(18, 0, 0, 0); // 6 PM for week recap
          if (recapTime > now) {
            const nid = await scheduleNotification({
              externalId,
              title: `🏆 Weekly recap`,
              body: `Amazing work this week on "${goal.title}"! See what you accomplished.`,
              data: {
                screen: 'GoalDetail',
                goal_id: goal.id,
                action: 'week_recap',
              },
              sendAt: recapTime.toISOString(),
            });
            if (nid) { newNotifIds.push(nid); scheduled++; }
          }
          weekEnd.setDate(weekEnd.getDate() + 7);
        }
      } else if (step.due_date) {
        // ── REGULAR STEP ────────────────────────────────────────────────────
        // One notification the day of (at user's preferred time), and one the day before as a heads-up
        const dueDate = new Date(step.due_date + 'T00:00:00Z');
        dueDate.setUTCHours(prefHour, prefMin, 0, 0);

        if (dueDate > now) {
          const nid = await scheduleNotification({
            externalId,
            title: `Goal step due today`,
            body: `"${step.title}" is due today in your goal: ${goal.title}`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_step_due',
              goal_id: goal.id,
              step_id: step.id,
            },
            sendAt: dueDate.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        }

        // Day-before reminder (at user's preferred time)
        const dayBefore = new Date(dueDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        if (dayBefore > now) {
          const nid2 = await scheduleNotification({
            externalId,
            title: `Goal step due tomorrow`,
            body: `"${step.title}" is due tomorrow. Get a head start!`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_step_tomorrow',
              goal_id: goal.id,
              step_id: step.id,
            },
            sendAt: dayBefore.toISOString(),
          });
          if (nid2) { newNotifIds.push(nid2); scheduled++; }
        }
      }

      // Save new notification IDs back to the step
      if (newNotifIds.length > 0 || existingIds.length > 0) {
        await base44.entities.GoalStep.update(step.id, {
          onesignal_notification_ids: newNotifIds,
        });
      }
    }

    // Schedule monthly summaries for the goal
    let monthStart = new Date(goal.target_date ? new Date(goal.target_date) : now);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(9, 0, 0, 0); // 9 AM on first day of month

    let monthEnd = new Date(goal.target_date ? new Date(goal.target_date) : now);
    monthEnd.setUTCDate(25); // ~end of month
    monthEnd.setUTCHours(19, 0, 0, 0); // 7 PM

    const goalStart = new Date(goal.created_date || now);
    let curMonth = new Date(goalStart);
    let monthNum = 1;

    while (curMonth <= (goal.target_date ? new Date(goal.target_date) : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000))) {
      // Month start: first day at 9 AM
      const mStart = new Date(curMonth);
      mStart.setUTCDate(1);
      mStart.setUTCHours(9, 0, 0, 0);
      if (mStart > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `🚀 Month ${monthNum} begins`,
          body: `Here's what you're tackling in Month ${monthNum} for "${goal.title}". Let's go!`,
          data: {
            screen: 'GoalDetail',
            goal_id: goal.id,
            action: 'month_preview',
          },
          sendAt: mStart.toISOString(),
        });
        if (nid) scheduled++;
      }

      // Month end: last day at 7 PM
      const mEnd = new Date(curMonth);
      mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
      mEnd.setUTCDate(0); // Last day of current month
      mEnd.setUTCHours(19, 0, 0, 0);
      if (mEnd > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `✨ Month ${monthNum} complete`,
          body: `You crushed Month ${monthNum}! Check out your progress on "${goal.title}".`,
          data: {
            screen: 'GoalDetail',
            goal_id: goal.id,
            action: 'month_recap',
          },
          sendAt: mEnd.toISOString(),
        });
        if (nid) scheduled++;
      }

      curMonth.setUTCMonth(curMonth.getUTCMonth() + 1);
      monthNum++;
    }

    return Response.json({ ok: true, scheduled, cancelled, steps_processed: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});