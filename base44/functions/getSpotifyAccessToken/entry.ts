import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

async function scheduleReminder({ externalId, title, body, data, minutesFromNow }) {
  const sendAfter = new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    headings: { en: title },
    contents: { en: body },
    data,
    channel_for_external_user_ids: "push",
    send_after: sendAfter,
  };
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`,
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
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const button_id = body.button_id;
    const step_id = body.step_id;
    const goal_id = body.goal_id;

    if (!button_id || !step_id) {
      return Response.json({ error: 'Missing params' }, { status: 400 });
    }

    const step = await base44.asServiceRole.entities.GoalStep.get(step_id);
    if (!step) {
      return Response.json({ error: 'Step not found' }, { status: 404 });
    }

    let result = {};

    if (button_id === 'complete') {
      await base44.asServiceRole.entities.GoalStep.update(step_id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      result = { action: 'completed' };

    } else if (button_id === 'remind_later') {
      const notifId = await scheduleReminder({
        externalId: user.email,
        title: 'Reminder: ' + step.title,
        body: 'You asked to be reminded in 3 hours.',
        data: {
          screen: 'GoalStepNotification',
          action: 'goal_step_followup',
          goal_id: step.goal_id || goal_id,
          step_id: step.id,
        },
        minutesFromNow: 180,
      });
      if (notifId) {
        const existing = Array.isArray(step.onesignal_notification_ids) ? step.onesignal_notification_ids : [];
        await base44.asServiceRole.entities.GoalStep.update(step_id, {
          onesignal_notification_ids: [...existing, notifId],
        });
      }
      result = { action: 'remind_later', notif_id: notifId };

    } else if (button_id === 'delegate') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const newDate = tomorrow.toISOString().split('T')[0];
      await base44.asServiceRole.entities.GoalStep.update(step_id, {
        due_date: newDate,
      });
      result = { action: 'delegate', new_due_date: newDate };

    } else if (button_id === 'shift_week') {
      const goalId = goal_id || step.goal_id;
      const allSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goalId });
      let shifted = 0;
      for (const s of allSteps) {
        if (!s.due_date || s.status === 'completed') continue;
        const d = new Date(s.due_date + 'T00:00:00Z');
        d.setDate(d.getDate() + 7);
        await base44.asServiceRole.entities.GoalStep.update(s.id, {
          due_date: d.toISOString().split('T')[0],
        });
        shifted++;
      }
      result = { action: 'shift_week', steps_shifted: shifted };

    } else {
      return Response.json({ error: 'Unknown button_id' }, { status: 400 });
    }

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});