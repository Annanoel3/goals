import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

// ── Send an immediate push ────────────────────────────────────────────────────
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  return json?.id || null;
}

// ── Schedule a future-dated push ──────────────────────────────────────────────
async function schedulePush({ externalId, title, body, data, sendAt, buttons }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    channel_for_external_user_ids: 'push',
    headings: { en: title },
    contents: { en: body },
    data,
    send_after: sendAt,
    ...(buttons ? { buttons } : {}),
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  return json?.id || null;
}

async function cancelPush(notifId) {
  try {
    await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch (_) {}
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

function parsePhase(phase) {
  if (!phase) return null;
  const full = phase.match(/Month\s+(\d+)\s+Week\s+(\d+)/i);
  if (full) return { month: parseInt(full[1]), week: parseInt(full[2]) };
  const monthOnly = phase.match(/Month\s+(\d+)/i);
  if (monthOnly) return { month: parseInt(monthOnly[1]), week: null };
  return null;
}

function localTimeOnDate(dateStr, localHour, localMin, tzOffsetMinutes) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(
    localHour + Math.floor(tzOffsetMinutes / 60),
    localMin + (tzOffsetMinutes % 60),
    0, 0
  );
  return d;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayUTC = new Date(todayStr + 'T00:00:00Z');
    const dayOfWeek = todayUTC.getDay();
    const dayOfMonth = todayUTC.getDate();

    const isMonday = dayOfWeek === 1;
    const isSunday = dayOfWeek === 0;
    const isFirstOfMonth = dayOfMonth === 1;
    const nextDay = new Date(todayUTC);
    nextDay.setDate(todayUTC.getDate() + 1);
    const isLastOfMonth = nextDay.getDate() === 1;

    const allUsers = await base44.asServiceRole.entities.User.list();
    const userByEmail = {};
    const userById = {};
    for (const u of allUsers) { userByEmail[u.email] = u; userById[u.id] = u; }

    const goals = await base44.asServiceRole.entities.Goal.list();
    const results = { week_preview: 0, week_summary: 0, month_preview: 0, month_summary: 0, rescheduled: 0, skipped: 0 };

    for (const goal of goals) {
      if (goal.status !== 'active') continue;

      const user = userById[goal.created_by_id] || userByEmail[goal.created_by];
      if (!user) continue;
      const externalId = user.email;

      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const completedSteps = steps.filter(s => s.status === 'completed');

      // ── SUNDAY: Roll the weekly notification window ──────────────────────────
      // Invoke scheduleGoalNotifications which uses AI to write personalized copy
      // for all steps due in the next 7 days.
      if (isSunday) {
        const tzOffset = user.timezone_offset || 0;
        await base44.asServiceRole.functions.invoke('scheduleGoalNotifications', {
          goal_id: goal.id,
          timezoneOffsetMinutes: tzOffset,
        });
        results.rescheduled++;
      }

      // ── AI-POWERED PERIODIC MESSAGES (Mon/Sun/1st/last only) ─────────────────
      if (!isMonday && !isSunday && !isFirstOfMonth && !isLastOfMonth) continue;

      const weeksElapsed = Math.floor((now - new Date(goal.created_date)) / (1000 * 60 * 60 * 24 * 7));
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

      const goalContext = `
Goal: "${goal.title}"
Category: ${goal.category || 'personal'}
Timeline: ${goal.timeline || 'unknown'}
Overall progress: ${completedSteps.length}/${steps.length} steps done (${progressPct}%)
Current phase: Month ${currentMonthNum}${monthTitle ? ` – "${monthTitle}"` : ''}, Week ${currentWeekNum}
User first name: ${user.full_name?.split(' ')[0] || 'there'}
      `.trim();

      // ── MONDAY: Week preview ─────────────────────────────────────────────────
      if (isMonday) {
        if (currentWeekSteps.length === 0) { results.skipped++; continue; }
        const stepList = currentWeekSteps.slice(0, 5).map(s => `- ${s.title}`).join('\n');
        const pendingCount = currentWeekSteps.filter(s => s.status !== 'completed').length;

        const msg = await generateMessage(openai,
          `You write motivating, personal, ADHD-friendly weekly goal preview notifications. Keep the in-app message warm, specific, and action-oriented. Max 3 sentences. Always reference the specific goal and what this week is about.
Return JSON: { "push_title": "short punchy title (max 8 words)", "push_body": "one line preview (max 15 words)", "in_app_message": "fuller motivating message shown when they open the app (2-3 sentences)" }`,
          `${goalContext}\n\nThis week's ${pendingCount} steps:\n${stepList}\n\nWrite a Monday morning week kickoff notification.`
        );

        const notifId = await sendPush({ externalId, title: msg.push_title, body: msg.push_body,
          data: { screen: 'GoalStepNotification', action: 'week_preview', goal_id: goal.id, in_app_message: msg.in_app_message, week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`, month_title: monthTitle || '' }
        });

        if (notifId) {
          const pending = goal.pending_notifications || [];
          pending.push({ id: notifId, type: 'week_preview', title: msg.push_title, message: msg.in_app_message, week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`, created_at: now.toISOString(), seen: false });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pending });
          results.week_preview++;
        }
      }

      // ── SUNDAY: Week wrap-up ─────────────────────────────────────────────────
      if (isSunday) {
        const weekStart = new Date(todayUTC);
        weekStart.setDate(todayUTC.getDate() - 6);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const dueThisWeek = steps.filter(s => s.due_date >= weekStartStr && s.due_date <= todayStr);
        const completedThisWeek = dueThisWeek.filter(s => s.status === 'completed');
        if (dueThisWeek.length === 0) { results.skipped++; continue; }

        const pct = Math.round((completedThisWeek.length / dueThisWeek.length) * 100);
        const completedTitles = completedThisWeek.slice(0, 4).map(s => `- ${s.title}`).join('\n');
        const missedTitles = dueThisWeek.filter(s => s.status !== 'completed').slice(0, 3).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write warm, encouraging weekly wrap-up notifications. Celebrate wins. Be kind about misses. Casual, warm, ADHD-friendly. No bullet points in the in-app message.
Return JSON: { "push_title": "short celebratory title (max 8 words)", "push_body": "one line summary (max 15 words)", "in_app_message": "warm wrap-up message (2-4 sentences, flowing prose)" }`,
          `${goalContext}\n\nThis week: ${completedThisWeek.length}/${dueThisWeek.length} steps (${pct}%)\n${completedTitles ? `Completed:\n${completedTitles}` : ''}\n${missedTitles ? `Missed:\n${missedTitles}` : ''}`
        );

        const notifId = await sendPush({ externalId, title: msg.push_title, body: msg.push_body,
          data: { screen: 'GoalStepNotification', action: 'week_summary', goal_id: goal.id, in_app_message: msg.in_app_message, week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`, completed: completedThisWeek.length, total: dueThisWeek.length, pct }
        });

        if (notifId) {
          const pending = goal.pending_notifications || [];
          pending.push({ id: notifId, type: 'week_summary', title: msg.push_title, message: msg.in_app_message, week_label: `Month ${currentMonthNum}, Week ${currentWeekNum}`, created_at: now.toISOString(), seen: false });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pending });
          results.week_summary++;
        }
      }

      // ── 1ST OF MONTH: Month preview ──────────────────────────────────────────
      if (isFirstOfMonth) {
        if (currentMonthSteps.length === 0) { results.skipped++; continue; }
        const stepList = currentMonthSteps.slice(0, 6).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write exciting, motivating monthly goal preview notifications for an ADHD productivity app. Fresh exciting chapter feel. Reference month theme if there is one. Personal and energizing.
Return JSON: { "push_title": "exciting month kickoff title (max 8 words)", "push_body": "one line teaser (max 15 words)", "in_app_message": "motivating month preview (3-4 sentences, build excitement)" }`,
          `${goalContext}\n\nMonth ${currentMonthNum} steps (${currentMonthSteps.length} total):\n${stepList}${currentMonthSteps.length > 6 ? `\n+ ${currentMonthSteps.length - 6} more` : ''}`
        );

        const notifId = await sendPush({ externalId, title: msg.push_title, body: msg.push_body,
          data: { screen: 'GoalStepNotification', action: 'month_preview', goal_id: goal.id, in_app_message: msg.in_app_message, month_label: `Month ${currentMonthNum}`, month_title: monthTitle || '' }
        });

        if (notifId) {
          const pending = goal.pending_notifications || [];
          pending.push({ id: notifId, type: 'month_preview', title: msg.push_title, message: msg.in_app_message, month_label: `Month ${currentMonthNum}`, created_at: now.toISOString(), seen: false });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pending });
          results.month_preview++;
        }
      }

      // ── LAST OF MONTH: Month wrap-up ─────────────────────────────────────────
      if (isLastOfMonth) {
        const monthStart = `${todayStr.slice(0, 7)}-01`;
        const dueThisMonth = steps.filter(s => s.due_date >= monthStart && s.due_date <= todayStr);
        const completedThisMonth = dueThisMonth.filter(s => s.status === 'completed');
        if (dueThisMonth.length === 0) { results.skipped++; continue; }

        const pct = Math.round((completedThisMonth.length / dueThisMonth.length) * 100);
        const completedTitles = completedThisMonth.slice(0, 5).map(s => `- ${s.title}`).join('\n');

        const msg = await generateMessage(openai,
          `You write deeply affirming, celebratory end-of-month notifications. Tone: you've been on a journey and should feel PROUD. Focus on growth, not metrics. Warm, personal, coach-like. Never harsh about missed steps.
Return JSON: { "push_title": "celebratory month-end title (max 8 words)", "push_body": "one line highlight (max 15 words)", "in_app_message": "warm month wrap-up (3-5 sentences, flowing prose)" }`,
          `${goalContext}\n\nMonth ${currentMonthNum}${monthTitle ? ` – "${monthTitle}"` : ''}: ${completedThisMonth.length}/${dueThisMonth.length} steps (${pct}%)\nCompleted:\n${completedTitles || '(none recorded)'}`
        );

        const notifId = await sendPush({ externalId, title: msg.push_title, body: msg.push_body,
          data: { screen: 'GoalStepNotification', action: 'month_summary', goal_id: goal.id, in_app_message: msg.in_app_message, month_label: `Month ${currentMonthNum}`, completed: completedThisMonth.length, total: dueThisMonth.length, pct }
        });

        if (notifId) {
          const pending = goal.pending_notifications || [];
          pending.push({ id: notifId, type: 'month_summary', title: msg.push_title, message: msg.in_app_message, month_label: `Month ${currentMonthNum}`, created_at: now.toISOString(), seen: false });
          await base44.asServiceRole.entities.Goal.update(goal.id, { pending_notifications: pending });
          results.month_summary++;
        }
      }
    }

    return Response.json({ success: true, date: todayStr, ...results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});