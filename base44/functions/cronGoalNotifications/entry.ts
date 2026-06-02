import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

async function sendPush({ externalId, title, body, data }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [String(externalId)] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    data: data || {},
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

async function generateMessage(openai, systemPrompt, userPrompt) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 300,
    response_format: { type: 'json_object' }
  });
  return JSON.parse(res.choices[0].message.content);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayUTC = new Date(todayStr + 'T00:00:00Z');
    const dayOfWeek = todayUTC.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = todayUTC.getDate();

    const isMonday = dayOfWeek === 1;
    const isSunday = dayOfWeek === 0;
    const isFirstOfMonth = dayOfMonth === 1;
    const nextDay = new Date(todayUTC);
    nextDay.setDate(todayUTC.getDate() + 1);
    const isLastOfMonth = nextDay.getDate() === 1;

    // Only run on the 4 trigger days
    if (!isMonday && !isSunday && !isFirstOfMonth && !isLastOfMonth) {
      return Response.json({ skipped: true, reason: 'not a trigger day', date: todayStr });
    }

    const allUsers = await base44.asServiceRole.entities.User.list();
    const userByEmail = {};
    for (const u of allUsers) userByEmail[u.email] = u;

    const goals = await base44.asServiceRole.entities.Goal.list();
    const results = { week_preview: 0, week_summary: 0, month_preview: 0, month_summary: 0, skipped_no_steps: 0 };

    for (const goal of goals) {
      if (goal.status !== 'active') continue;
      const user = userByEmail[goal.created_by];
      if (!user) continue;
      const externalId = user.email;

      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const pendingSteps = steps.filter(s => s.status !== 'completed' && s.status !== 'skipped');
      const completedSteps = steps.filter(s => s.status === 'completed');

      // Figure out where the user currently is in the plan
      const createdDate = new Date(goal.created_date);
      const weeksElapsed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24 * 7));
      const currentMonthNum = Math.floor(weeksElapsed / 4) + 1;
      const currentWeekNum = (weeksElapsed % 4) + 1;

      const currentWeekSteps = steps.filter(s =>
        s.phase &&
        new RegExp(`Month\\s*${currentMonthNum}`, 'i').test(s.phase) &&
        new RegExp(`Week\\s*${currentWeekNum}`, 'i').test(s.phase)
      );
      const currentMonthSteps = steps.filter(s =>
        s.phase && new RegExp(`Month\\s*${currentMonthNum}\\b`, 'i').test(s.phase)
      );

      const progressPct = steps.length > 0 ? Math.round((completedSteps.length / steps.length) * 100) : 0;
      const monthTitle = goal.month_titles?.[String(currentMonthNum)] || null;

      // Context for AI
      const goalContext = `
Goal: "${goal.title}"
Category: ${goal.category || 'personal'}
Timeline: ${goal.timeline || 'unknown'}
Overall progress: ${completedSteps.length}/${steps.length} steps done (${progressPct}%)
Current phase: Month ${currentMonthNum}${monthTitle ? ` – "${monthTitle}"` : ''}, Week ${currentWeekNum}
User first name: ${user.full_name?.split(' ')[0] || 'there'}
      `.trim();

      // ── MONDAY: Week preview ───────────────────────────────────────────────────
      if (isMonday) {
        if (currentWeekSteps.length === 0) { results.skipped_no_steps++; continue; }

        const stepList = currentWeekSteps.slice(0, 5).map(s => `- ${s.title}`).join('\n');
        const pendingCount = currentWeekSteps.filter(s => s.status !== 'completed').length;

        const msg = await generateMessage(openai,
          `You write motivating, personal, ADHD-friendly weekly goal preview notifications. 
           Keep the in-app message warm, specific, and action-oriented. Max 3 sentences.
           Always reference the specific goal and what this week is about.
           Return JSON: { "push_title": "short punchy title (max 8 words)", "push_body": "one line preview (max 15 words)", "in_app_message": "fuller motivating message shown when they open the app (2-3 sentences)" }`,
          `${goalContext}

This week's ${pendingCount} steps:
${stepList}

Write a Monday morning week kickoff notification. Make it feel like a personal coach pumping them up for the week ahead.`
        );

        const notifId = await sendPush({
          externalId,
          title: msg.push_title,
          body: msg.push_body,
          data: {
            screen: 'GoalStepNotification',
            action: 'week_preview',
            goal_id: goal.id,
            in_app_message: msg.in_app_message,
            week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`,
            month_title: monthTitle || '',
          }
        });

        // Store as pending in-app message on goal so it shows on next app open even if not tapped
        if (notifId) {
          const pendingMsgs = goal.pending_notifications || [];
          pendingMsgs.push({
            id: notifId,
            type: 'week_preview',
            title: msg.push_title,
            message: msg.in_app_message,
            week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`,
            created_at: now.toISOString(),
            seen: false
          });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pendingMsgs });
          results.week_preview++;
        }
      }

      // ── SUNDAY: Week wrap-up summary ──────────────────────────────────────────
      if (isSunday) {
        const weekStart = new Date(todayUTC);
        weekStart.setDate(todayUTC.getDate() - 6);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const dueThisWeek = steps.filter(s => s.due_date >= weekStartStr && s.due_date <= todayStr);
        const completedThisWeek = dueThisWeek.filter(s => s.status === 'completed');

        if (dueThisWeek.length === 0) { results.skipped_no_steps++; continue; }

        const pct = Math.round((completedThisWeek.length / dueThisWeek.length) * 100);
        const completedTitles = completedThisWeek.slice(0, 4).map(s => `- ${s.title}`).join('\n');
        const missedTitles = dueThisWeek.filter(s => s.status !== 'completed').slice(0, 3).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write warm, encouraging weekly wrap-up notifications for a goal tracking app. 
           The vibe is: give yourself a pat on the back. Celebrate wins. Be kind about misses.
           This is NOT a place for harsh accountability — it's a moment of reflection and pride.
           Keep language casual, warm, ADHD-friendly. No bullet points in the in-app message.
           Return JSON: { "push_title": "short celebratory title (max 8 words)", "push_body": "one line summary (max 15 words)", "in_app_message": "warm wrap-up message (2-4 sentences, flowing prose)" }`,
          `${goalContext}

This week: ${completedThisWeek.length} of ${dueThisWeek.length} steps completed (${pct}%)
${completedTitles ? `Completed:\n${completedTitles}` : ''}
${missedTitles ? `Didn't get to:\n${missedTitles}` : ''}

Write a Sunday evening wrap-up. Focus on what they DID accomplish. If they missed some, be gentle and forward-looking. Make them feel proud of the effort.`
        );

        const notifId = await sendPush({
          externalId,
          title: msg.push_title,
          body: msg.push_body,
          data: {
            screen: 'GoalStepNotification',
            action: 'week_summary',
            goal_id: goal.id,
            in_app_message: msg.in_app_message,
            week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`,
            completed: completedThisWeek.length,
            total: dueThisWeek.length,
            pct,
          }
        });

        if (notifId) {
          const pendingMsgs = goal.pending_notifications || [];
          pendingMsgs.push({
            id: notifId,
            type: 'week_summary',
            title: msg.push_title,
            message: msg.in_app_message,
            week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`,
            created_at: now.toISOString(),
            seen: false
          });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pendingMsgs });
          results.week_summary++;
        }
      }

      // ── 1ST OF MONTH: Month preview ───────────────────────────────────────────
      if (isFirstOfMonth) {
        if (currentMonthSteps.length === 0) { results.skipped_no_steps++; continue; }

        const stepList = currentMonthSteps.slice(0, 6).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write exciting, motivating monthly goal preview notifications for an ADHD productivity app.
           This is the start of a new month — make it feel like a fresh exciting chapter.
           Reference the specific month theme if there is one. Be personal and energizing.
           Return JSON: { "push_title": "exciting month kickoff title (max 8 words)", "push_body": "one line teaser (max 15 words)", "in_app_message": "motivating month preview (3-4 sentences, build excitement for what's ahead)" }`,
          `${goalContext}

Month ${currentMonthNum} steps (${currentMonthSteps.length} total):
${stepList}${currentMonthSteps.length > 6 ? `\n+ ${currentMonthSteps.length - 6} more` : ''}

Write a 1st-of-month preview notification. Make this month feel like an exciting new chapter in their journey.`
        );

        const notifId = await sendPush({
          externalId,
          title: msg.push_title,
          body: msg.push_body,
          data: {
            screen: 'GoalStepNotification',
            action: 'month_preview',
            goal_id: goal.id,
            in_app_message: msg.in_app_message,
            month_label: `Month ${currentMonthNum}`,
            month_title: monthTitle || '',
          }
        });

        if (notifId) {
          const pendingMsgs = goal.pending_notifications || [];
          pendingMsgs.push({
            id: notifId,
            type: 'month_preview',
            title: msg.push_title,
            message: msg.in_app_message,
            month_label: `Month ${currentMonthNum}`,
            created_at: now.toISOString(),
            seen: false
          });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pendingMsgs });
          results.month_preview++;
        }
      }

      // ── LAST OF MONTH: Month wrap-up ──────────────────────────────────────────
      if (isLastOfMonth) {
        const monthStart = `${todayStr.slice(0, 7)}-01`;
        const dueThisMonth = steps.filter(s => s.due_date >= monthStart && s.due_date <= todayStr);
        const completedThisMonth = dueThisMonth.filter(s => s.status === 'completed');

        if (dueThisMonth.length === 0) { results.skipped_no_steps++; continue; }

        const pct = Math.round((completedThisMonth.length / dueThisMonth.length) * 100);
        const completedTitles = completedThisMonth.slice(0, 5).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write deeply affirming, celebratory end-of-month notifications for a goal tracking app.
           The tone is: you've been on a journey this month and you should feel PROUD.
           Focus on growth and momentum, not metrics. Be warm, personal, coach-like.
           Never be harsh about missed steps — reframe everything as learning and forward momentum.
           Return JSON: { "push_title": "celebratory month-end title (max 8 words)", "push_body": "one line highlight (max 15 words)", "in_app_message": "warm month wrap-up (3-5 sentences, flowing prose, make them feel accomplished)" }`,
          `${goalContext}

Month ${currentMonthNum}${monthTitle ? ` – "${monthTitle}"` : ''}: ${completedThisMonth.length} of ${dueThisMonth.length} steps done (${pct}%)
Completed this month:
${completedTitles || '(none recorded)'}

Write a last-day-of-month wrap-up. This is a reflective moment. Make them feel proud of what they built this month, regardless of the percentage. Look forward to next month too.`
        );

        const notifId = await sendPush({
          externalId,
          title: msg.push_title,
          body: msg.push_body,
          data: {
            screen: 'GoalStepNotification',
            action: 'month_summary',
            goal_id: goal.id,
            in_app_message: msg.in_app_message,
            month_label: `Month ${currentMonthNum}`,
            completed: completedThisMonth.length,
            total: dueThisMonth.length,
            pct,
          }
        });

        if (notifId) {
          const pendingMsgs = goal.pending_notifications || [];
          pendingMsgs.push({
            id: notifId,
            type: 'month_summary',
            title: msg.push_title,
            message: msg.in_app_message,
            month_label: `Month ${currentMonthNum}`,
            created_at: now.toISOString(),
            seen: false
          });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pendingMsgs });
          results.month_summary++;
        }
      }
    }

    return Response.json({ success: true, date: todayStr, trigger: { isMonday, isSunday, isFirstOfMonth, isLastOfMonth }, ...results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});