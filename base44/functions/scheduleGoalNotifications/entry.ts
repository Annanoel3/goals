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
    include_aliases: { external_id: [String(externalId)] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    data,
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
    const { goal_id, timezoneOffsetMinutes } = body;
    if (!goal_id) return Response.json({ error: 'Missing goal_id' }, { status: 400 });

    const goalResults = await base44.entities.Goal.filter({ id: goal_id });
    const goal = goalResults[0];
    if (!goal) return Response.json({ error: 'Entity Goal with ID ' + goal_id + ' not found' }, { status: 404 });

    const steps = await base44.entities.GoalStep.filter({ goal_id });
    const externalId = user.email;
    const now = new Date();

    let scheduled = 0;
    let cancelled = 0;

    // tzOffset: minutes to add to UTC to get local time (e.g. CDT = -300 → offset = -300)
    // timezoneOffsetMinutes from JS Date.getTimezoneOffset() is positive for west-of-UTC (e.g. CDT = +300)
    // So to convert local hour → UTC: utcHour = localHour + (timezoneOffsetMinutes / 60)
    // timezoneOffsetMinutes from JS Date.getTimezoneOffset(): positive = west of UTC (e.g. CDT=300, IST=-330)
    // Default 0 (UTC) if not provided — better than assuming a specific timezone
    const tzOffsetMinutes = typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0;

    // Get user's preferred notification time (default 9 AM local)
    let prefHour = 9;
    let prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) {
        prefHour = parseInt(tp[1]);
        prefMin = parseInt(tp[2]);
      }
    }

    // Helper: given a local hour/min and a date string (YYYY-MM-DD), return a UTC Date at that local time
    function localTimeOnDate(dateStr, localHour, localMin) {
      const d = new Date(dateStr + 'T00:00:00Z');
      // Set to local time by adding tzOffset (getTimezoneOffset is positive for west)
      d.setUTCHours(localHour + Math.floor(tzOffsetMinutes / 60), localMin + (tzOffsetMinutes % 60), 0, 0);
      return d;
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
        const startDate = step.due_date ? new Date(step.due_date + 'T00:00:00Z') : now;
        const habitStart = startDate < now
          ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
          : startDate;

        const goalEnd = goal.target_date
          ? new Date(goal.target_date + 'T23:59:59Z')
          : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

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

        // Schedule daily reminders — cap at 60 days to avoid too many notifications
        let d = new Date(habitStart);
        const capEnd = new Date(Math.min(goalEnd.getTime(), now.getTime() + 60 * 24 * 60 * 60 * 1000));
        let dayCount = 0;
        while (d <= capEnd) {
          const dateStr = d.toISOString().split('T')[0];
          const sendAt = localTimeOnDate(dateStr, notifHour, notifMin);
          if (sendAt > now) {
            // Make message phase-specific for steps with phases
            let notifBody = generateDailyMessage(goal, step);
            if (step.phase) {
              const phaseMatch = step.phase.match(/Week\s+(\d+)/i);
              if (phaseMatch) {
                const weekNum = parseInt(phaseMatch[1]);
                switch (weekNum) {
                  case 1:
                    notifBody = `${goal.title} - Week ${weekNum} begins! Let's dive in. 📖`;
                    break;
                  case 2:
                    notifBody = `${goal.title} - Halfway through Week ${weekNum}. You're making progress! 💪`;
                    break;
                  case 3:
                    notifBody = `${goal.title} - Week ${weekNum}: the home stretch. Keep going! 🎯`;
                    break;
                  case 4:
                    notifBody = `${goal.title} - Final week! Finish strong and reflect. ✨`;
                    break;
                  default:
                    notifBody = `${goal.title} - Week ${weekNum}: ${generateDailyMessage(goal, step)}`;
                }
              }
            }
            const nid = await scheduleNotification({
              externalId,
              title: `Daily check-in`,
              body: notifBody,
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
          d.setUTCDate(d.getUTCDate() + 1);
          dayCount++;
        }

      } else if (step.due_date) {
        // ── REGULAR STEP ────────────────────────────────────────────────────
        // Daily reminder from today until due date (at preferred local time), plus a day-before heads-up
        const dueDate = new Date(step.due_date + 'T00:00:00Z');
        const dueSendAt = localTimeOnDate(step.due_date, prefHour, prefMin);

        // Day-before reminder
        const dayBeforeDate = new Date(dueDate);
        dayBeforeDate.setUTCDate(dayBeforeDate.getUTCDate() - 1);
        const dayBeforeStr = dayBeforeDate.toISOString().split('T')[0];
        const dayBeforeSendAt = localTimeOnDate(dayBeforeStr, prefHour, prefMin);

        if (dayBeforeSendAt > now) {
          const nid = await scheduleNotification({
            externalId,
            title: `"${step.title}" is due tomorrow`,
            body: `Get a head start on this step for your goal: ${goal.title}`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_step_tomorrow',
              goal_id: goal.id,
              step_id: step.id,
            },
            sendAt: dayBeforeSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        }

        if (dueSendAt > now) {
          const nid = await scheduleNotification({
            externalId,
            title: `"${step.title}" is due today`,
            body: `Time to work on this step for your goal: ${goal.title}`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_step_due',
              goal_id: goal.id,
              step_id: step.id,
            },
            sendAt: dueSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        }

        // Daily reminder every day from today until due date
        let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        while (d < dueDate) {
          const dateStr = d.toISOString().split('T')[0];
          const sendAt = localTimeOnDate(dateStr, prefHour, prefMin);
          if (sendAt > now) {
            const nid = await scheduleNotification({
              externalId,
              title: `Daily reminder: ${goal.title}`,
              body: generateDailyMessage(goal, step),
              data: {
                screen: 'GoalStepNotification',
                action: 'goal_step',
                goal_id: goal.id,
                step_id: step.id,
              },
              sendAt: sendAt.toISOString(),
            });
            if (nid) { newNotifIds.push(nid); scheduled++; }
          }
          d.setUTCDate(d.getUTCDate() + 1);
        }
      }

      // Save new notification IDs back to the step
      if (newNotifIds.length > 0 || existingIds.length > 0) {
        await base44.entities.GoalStep.update(step.id, {
          onesignal_notification_ids: newNotifIds,
        });
      }
    }

    // Cancel existing goal-level notifications before rescheduling
    const existingGoalNotifIds = goal.onesignal_notification_ids || [];
    for (const nid of existingGoalNotifIds) {
      await cancelNotification(nid);
      cancelled++;
    }

    // Schedule monthly summaries for the goal
    const goalNotifIds = [];
    const goalStart = new Date(goal.created_date || now);
    let curMonth = new Date(goalStart);
    let monthNum = 1;

    while (curMonth <= (goal.target_date ? new Date(goal.target_date) : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000))) {
      // Month start: first day at 9 AM local
      const mStart = new Date(curMonth);
      mStart.setUTCDate(1);
      const mStartStr = mStart.toISOString().split('T')[0];
      const mStartLocal = localTimeOnDate(mStartStr, 9, 0);
      if (mStartLocal > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `🚀 Month ${monthNum} begins`,
          body: `Here's what you're tackling in Month ${monthNum} for "${goal.title}". Let's go!`,
          data: {
            screen: 'GoalDetail',
            goal_id: goal.id,
            action: 'month_preview',
          },
          sendAt: mStartLocal.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      // Month end: last day at 7 PM local
      const mEnd = new Date(curMonth);
      mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
      mEnd.setUTCDate(0); // Last day of current month
      const mEndStr = mEnd.toISOString().split('T')[0];
      const mEndLocal = localTimeOnDate(mEndStr, 19, 0);
      if (mEndLocal > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `✨ Month ${monthNum} complete`,
          body: `You crushed Month ${monthNum}! Check out your progress on "${goal.title}".`,
          data: {
            screen: 'GoalDetail',
            goal_id: goal.id,
            action: 'month_recap',
          },
          sendAt: mEndLocal.toISOString(),
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      curMonth.setUTCMonth(curMonth.getUTCMonth() + 1);
      monthNum++;
    }

    // Save goal-level notification IDs back to the goal
    await base44.entities.Goal.update(goal.id, {
      onesignal_notification_ids: goalNotifIds,
    });

    return Response.json({ ok: true, scheduled, cancelled, steps_processed: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});