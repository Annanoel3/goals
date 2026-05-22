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
              title: `Daily habit: ${step.title}`,
              body: `Time for your daily habit! Tap to check in.`,
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

    return Response.json({ ok: true, scheduled, cancelled, steps_processed: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});