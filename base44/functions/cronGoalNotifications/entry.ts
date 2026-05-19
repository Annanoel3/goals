import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

async function sendPush({ externalId, title, body, data }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    headings: { en: title },
    contents: { en: body },
    data: data || {},
    channel_for_external_user_ids: "push",
  };
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  return json?.id || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    // Use UTC — cron fires at 8am UTC (adjust in automation if needed)
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const todayUTC = new Date(todayStr + 'T00:00:00Z');
    const dayOfWeek = todayUTC.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = todayUTC.getDate();

    const isMonday = dayOfWeek === 1;
    const isFirstOfMonth = dayOfMonth === 1;

    const goals = await base44.asServiceRole.entities.Goal.list();
    const results = { month_notifs: 0, week_notifs: 0, step_notifs: 0, followup_notifs: 0 };

    for (const goal of goals) {
      if (goal.status !== 'active') continue;

      // Get user
      const allUsers = await base44.asServiceRole.entities.User.list();
      const user = allUsers.find(u => u.email === goal.created_by);
      if (!user) continue;
      const externalId = user.email;

      // Get all steps for this goal
      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const pendingSteps = steps.filter(s => s.status !== 'completed' && s.status !== 'skipped');

      // ── 1. MONTH START: first of month → summarize upcoming month ────────────
      if (isFirstOfMonth) {
        // Find which month we're in based on current date vs goal creation
        const createdDate = new Date(goal.created_date);
        const monthsElapsed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24 * 30.44));
        const currentMonthNum = monthsElapsed + 1;
        const currentMonthLabel = `Month ${currentMonthNum}`;

        // Find steps belonging to this month
        const monthSteps = pendingSteps.filter(s =>
          s.phase && new RegExp(`Month\\s*${currentMonthNum}\\b`, 'i').test(s.phase)
        );

        if (monthSteps.length > 0) {
          const stepTitles = monthSteps.slice(0, 3).map(s => `• ${s.title}`).join('\n');
          const more = monthSteps.length > 3 ? `\n+ ${monthSteps.length - 3} more` : '';
          await sendPush({
            externalId,
            title: `${currentMonthLabel} starts today! 🗓️`,
            body: `Here's what's coming up for "${goal.title}":\n${stepTitles}${more}`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_month',
              goal_id: goal.id,
              month_label: currentMonthLabel,
            }
          });
          results.month_notifs++;
        }
      }

      // ── 2. WEEK START: Monday → summarize upcoming week ───────────────────────
      if (isMonday) {
        // Calculate current week based on goal start
        const createdDate = new Date(goal.created_date);
        const weeksElapsed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24 * 7));
        const currentWeekNum = (weeksElapsed % 4) + 1;
        const currentMonthNum2 = Math.floor(weeksElapsed / 4) + 1;
        const currentWeekLabel = `Month ${currentMonthNum2}, Week ${currentWeekNum}`;

        const weekSteps = pendingSteps.filter(s =>
          s.phase && s.phase.toLowerCase().includes(`month ${currentMonthNum2}`) &&
          s.phase.toLowerCase().includes(`week ${currentWeekNum}`)
        );

        if (weekSteps.length > 0) {
          const stepTitles = weekSteps.slice(0, 4).map(s => `• ${s.title}`).join('\n');
          const more = weekSteps.length > 4 ? `\n+ ${weekSteps.length - 4} more` : '';
          await sendPush({
            externalId,
            title: `New week, new steps! 💪`,
            body: `${currentWeekLabel} of "${goal.title}":\n${stepTitles}${more}`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_week',
              goal_id: goal.id,
              week_label: currentWeekLabel,
            }
          });
          results.week_notifs++;
        }
      }

      // ── 3. MORNING REMINDER: step due today ───────────────────────────────────
      const todaySteps = pendingSteps.filter(s => s.due_date === todayStr);
      for (const step of todaySteps) {
        // Don't double-notify if already sent today (check notification ids count)
        const alreadySent = step.onesignal_notification_ids?.length > 0;
        // Only skip if sent today — we check by seeing if last id was set after midnight today
        // Simple guard: don't send if step has ids and wasn't modified today
        if (alreadySent) continue;

        const notifId = await sendPush({
          externalId,
          title: `Today's step: ${step.title}`,
          body: step.description
            ? `${step.description.slice(0, 100)}${step.description.length > 100 ? '…' : ''}`
            : `Tap to view details and mark complete.`,
          data: {
            screen: 'GoalStepNotification',
            action: 'goal_step',
            goal_id: goal.id,
            step_id: step.id,
          }
        });

        if (notifId) {
          const existing = step.onesignal_notification_ids || [];
          await base44.asServiceRole.entities.GoalStep.update(step.id, {
            onesignal_notification_ids: [...existing, notifId]
          });
          results.step_notifs++;
        }
      }

      // ── 4. FOLLOW-UP: step was due YESTERDAY and still not done ──────────────
      const yesterdayDate = new Date(todayUTC.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

      const overdueYesterdaySteps = pendingSteps.filter(s => s.due_date === yesterdayStr);
      for (const step of overdueYesterdaySteps) {
        await sendPush({
          externalId,
          title: `Did you get to this? 🤔`,
          body: `"${step.title}" was due yesterday. Tap to mark it done or reschedule.`,
          data: {
            screen: 'GoalStepNotification',
            action: 'goal_step_followup',
            goal_id: goal.id,
            step_id: step.id,
          }
        });
        results.followup_notifs++;
      }
    }

    return Response.json({ success: true, date: todayStr, ...results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});