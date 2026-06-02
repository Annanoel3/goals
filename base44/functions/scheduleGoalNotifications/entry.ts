import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

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

async function scheduleNotification({ externalId, title, body, data, sendAt, buttons }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [String(externalId)],
    headings: { en: title },
    contents: { en: body },
    data,
    channel_for_external_user_ids: 'push',
    send_after: sendAt,
    ...(buttons ? { buttons } : {
      buttons: [
        { id: 'complete', text: '✅ Done' },
        { id: 'remind_later', text: '🔔 Remind Later' },
      ]
    }),
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return json?.id || null;
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

// Use AI to generate personalized notification copy for a batch of steps
async function generateStepNotifications(openai, goal, steps, user, completedCount, totalCount) {
  const firstName = user.full_name?.split(' ')[0] || 'there';
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const stepList = steps.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description || '',
    due_date: s.due_date,
    phase: s.phase || '',
    tips: s.tips_and_guidance || '',
  }));

  const prompt = `You are writing personalized push notifications for ${firstName}, who is working on the goal: "${goal.title}".
Goal category: ${goal.category || 'personal'}
Overall progress: ${completedCount}/${totalCount} steps done (${progressPct}%)
Plan summary: ${goal.plan_summary || ''}

For each step below, write TWO notifications:
1. "day_before" — sent the day before it's due. Warm, specific, motivating. Reference what they'll actually be doing.
2. "due_day" — sent the morning it's due. Energizing, action-oriented, ADHD-friendly. Short and punchy.

Each notification needs:
- title: max 8 words, include a relevant emoji
- body: max 15 words, specific to THIS step (never generic)

Steps to write for:
${JSON.stringify(stepList, null, 2)}

Return JSON:
{
  "notifications": [
    {
      "step_id": "...",
      "day_before": { "title": "...", "body": "..." },
      "due_day": { "title": "...", "body": "..." }
    }
  ]
}`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  // Build a map of step_id -> { day_before, due_day }
  const map = {};
  for (const n of (parsed.notifications || [])) {
    map[n.step_id] = n;
  }
  return map;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

    const { goal_id, timezoneOffsetMinutes } = await req.json();
    if (!goal_id) return Response.json({ error: 'goal_id required' }, { status: 400 });

    const tzOffset = typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Window: schedule notifications for steps due in the next 7 days
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const windowEndStr = windowEnd.toISOString().split('T')[0];

    let goal;
    try { goal = await base44.asServiceRole.entities.Goal.get(goal_id); } catch (_) {}
    if (!goal) return Response.json({ error: 'Goal not found', goal_id }, { status: 404 });

    const allSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
    const user = await base44.asServiceRole.entities.User.get(goal.created_by_id);
    const externalId = user?.email;
    if (!externalId) return Response.json({ error: 'No user email' }, { status: 400 });

    let prefHour = 9, prefMin = 0;
    if (user?.preferred_notification_time) {
      const tp = user.preferred_notification_time.match(/(\d{1,2}):(\d{2})/);
      if (tp) { prefHour = parseInt(tp[1]); prefMin = parseInt(tp[2]); }
    }

    const completedCount = allSteps.filter(s => s.status === 'completed').length;
    const totalCount = allSteps.length;

    // Steps due within the next 7 days (non-habit milestone steps only)
    const windowSteps = allSteps.filter(s =>
      s.due_date &&
      !s.is_daily_habit &&
      s.status !== 'completed' &&
      s.status !== 'skipped' &&
      s.due_date >= todayStr &&
      s.due_date <= windowEndStr
    );

    let scheduled = 0, cancelled = 0;

    // Cancel existing notifications for ALL steps (clean slate for the window)
    for (const step of allSteps) {
      const existingIds = step.onesignal_notification_ids || [];
      for (const nid of existingIds) { await cancelNotification(nid); cancelled++; }
    }

    // Generate AI-personalized notification copy for all window steps in one call
    let aiNotifMap = {};
    if (windowSteps.length > 0) {
      aiNotifMap = await generateStepNotifications(openai, goal, windowSteps, user, completedCount, totalCount);
    }

    // Schedule personalized notifications for each window step
    for (const step of windowSteps) {
      const newNotifIds = [];
      const ai = aiNotifMap[step.id];

      // Day-before notification
      const dayBeforeStr = addDays(step.due_date, -1);
      const dayBeforeSendAt = localTimeOnDate(dayBeforeStr, prefHour, prefMin, tzOffset);
      if (dayBeforeSendAt > now) {
        const title = ai?.day_before?.title || `📌 "${step.title}" is due tomorrow`;
        const body = ai?.day_before?.body || `Get a head start on this step for ${goal.title}`;
        const nid = await scheduleNotification({
          externalId,
          title, body,
          data: { screen: 'GoalStepNotification', action: 'goal_step_tomorrow', goal_id: goal.id, step_id: step.id },
          sendAt: dayBeforeSendAt.toISOString(),
        });
        if (nid) { newNotifIds.push(nid); scheduled++; }
      }

      // Due-day notification
      const dueSendAt = localTimeOnDate(step.due_date, prefHour, prefMin, tzOffset);
      if (dueSendAt > now) {
        const title = ai?.due_day?.title || `🎯 "${step.title}" is due today`;
        const body = ai?.due_day?.body || `Time to work on this step for ${goal.title}`;
        const nid = await scheduleNotification({
          externalId,
          title, body,
          data: { screen: 'GoalStepNotification', action: 'goal_step_due', goal_id: goal.id, step_id: step.id },
          sendAt: dueSendAt.toISOString(),
        });
        if (nid) { newNotifIds.push(nid); scheduled++; }
      }

      await base44.asServiceRole.entities.GoalStep.update(step.id, {
        onesignal_notification_ids: newNotifIds,
      });
    }

    // Clear notification IDs for steps outside the window
    for (const step of allSteps) {
      if (!windowSteps.find(s => s.id === step.id)) {
        await base44.asServiceRole.entities.GoalStep.update(step.id, { onesignal_notification_ids: [] });
      }
    }

    // ── WEEK/MONTH BEGIN + END NOTIFICATIONS (for weeks starting in the next 7 days) ──
    const isMilestoneGoal = !allSteps.some(s => s.is_daily_habit && s.habit_time);
    const existingGoalNotifIds = goal.onesignal_notification_ids || [];
    for (const nid of existingGoalNotifIds) { await cancelNotification(nid); cancelled++; }
    const goalNotifIds = [];

    const weekMap = {};
    const monthMap = {};
    for (const step of allSteps) {
      if (!step.due_date) continue;
      const p = parsePhase(step.phase);
      if (!p) continue;
      const mk = String(p.month);
      if (!monthMap[mk]) monthMap[mk] = { month: p.month, dates: [] };
      monthMap[mk].dates.push(step.due_date);
      if (p.week !== null) {
        const wk = `${p.month}-${p.week}`;
        if (!weekMap[wk]) weekMap[wk] = { month: p.month, week: p.week, dates: [], titles: [] };
        weekMap[wk].dates.push(step.due_date);
        if (step.title) weekMap[wk].titles.push(step.title);
      }
    }

    for (const wData of Object.values(weekMap)) {
      const sortedDates = [...wData.dates].sort();
      const weekEndDate = sortedDates[sortedDates.length - 1];
      const weekStartDate = addDays(weekEndDate, -6);
      if (weekStartDate > windowEndStr) continue; // Only schedule weeks starting within the window

      const monthTheme = goal.month_titles?.[wData.month];
      const weekFocus = wData.titles.slice(0, 2).join(' & ') || monthTheme || goal.title;

      const weekBeginSendAt = localTimeOnDate(weekStartDate, prefHour, prefMin, tzOffset);
      if (weekBeginSendAt > now) {
        const nid = await scheduleNotification({
          externalId,
          title: `📅 Month ${wData.month}, Week ${wData.week} begins`,
          body: monthTheme ? `"${monthTheme}" — this week: ${weekFocus} 🚀` : `Week ${wData.week}: ${weekFocus} 🚀`,
          data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekBeginSendAt.toISOString(),
          buttons: [],
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      const weekEndSendAt = localTimeOnDate(weekEndDate, 19, 0, tzOffset);
      if (weekEndSendAt > now && weekEndDate <= windowEndStr) {
        const nid = await scheduleNotification({
          externalId,
          title: `🏁 Week ${wData.week} wrap-up`,
          body: `How did Week ${wData.week} go? Reflect on what you accomplished. 💪`,
          data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, month: wData.month, week: wData.week },
          sendAt: weekEndSendAt.toISOString(),
          buttons: [],
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }
    }

    for (const mData of Object.values(monthMap)) {
      const sortedDates = [...mData.dates].sort();
      const monthStartDate = sortedDates[0];
      const monthEndDate = sortedDates[sortedDates.length - 1];
      const monthTheme = goal.month_titles?.[mData.month];

      const mBeginSendAt = localTimeOnDate(monthStartDate, prefHour, prefMin, tzOffset);
      if (mBeginSendAt > now && monthStartDate <= windowEndStr) {
        const nid = await scheduleNotification({
          externalId,
          title: `📅 Month ${mData.month} begins`,
          body: monthTheme ? `Month ${mData.month}: "${monthTheme}" for "${goal.title}". Let's go! 🎯` : `Month ${mData.month} of "${goal.title}" starts now. Make it count! 🎯`,
          data: { screen: 'GoalDetail', action: 'month_begin', goal_id: goal.id, month: mData.month },
          sendAt: mBeginSendAt.toISOString(),
          buttons: [],
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }

      const mEndSendAt = localTimeOnDate(monthEndDate, 19, 0, tzOffset);
      if (mEndSendAt > now && monthEndDate <= windowEndStr) {
        const nid = await scheduleNotification({
          externalId,
          title: monthTheme ? `🌟 Month ${mData.month}: "${monthTheme}" — complete!` : `🌟 Month ${mData.month} complete!`,
          body: `How did Month ${mData.month} go for "${goal.title}"? Zoom out — see the full picture. 📊`,
          data: { screen: 'GoalDetail', action: 'month_end', goal_id: goal.id, month: mData.month, ...(isMilestoneGoal && { trigger_celebration: true }) },
          sendAt: mEndSendAt.toISOString(),
          buttons: [],
        });
        if (nid) { goalNotifIds.push(nid); scheduled++; }
      }
    }

    await base44.asServiceRole.entities.Goal.update(goal.id, { onesignal_notification_ids: goalNotifIds });

    return Response.json({ ok: true, scheduled, cancelled, steps_in_window: windowSteps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});