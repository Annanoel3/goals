import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")?.trim();
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")?.trim();

console.log(`[scheduleGoalNotifications] MODULE LOAD: ONESIGNAL_APP_ID=${ONESIGNAL_APP_ID ? 'SET(' + ONESIGNAL_APP_ID.substring(0,8) + '...)' : 'MISSING'}, ONESIGNAL_REST_API_KEY=${ONESIGNAL_REST_API_KEY ? 'SET' : 'MISSING'}`);

async function cancelNotification(notifId) {
  try {
    const res = await fetch(`https://onesignal.com/api/v1/notifications/${notifId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` },
    });
    console.log(`[scheduleGoalNotifications] cancelNotification ${notifId}: status=${res.status}`);
  } catch (err) {
    console.error(`[scheduleGoalNotifications] cancelNotification ${notifId} THREW: ${err.message}`);
  }
}

async function scheduleNotification({ externalId, title, body, data, sendAt }) {
  console.log(`[scheduleGoalNotifications] scheduleNotification: externalId=${externalId}, title="${title}", sendAt=${sendAt}`);
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.error(`[scheduleGoalNotifications] scheduleNotification ABORTED: missing OneSignal credentials`);
    throw new Error('Missing OneSignal credentials');
  }
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [String(externalId)] },
    headings: { en: title },
    contents: { en: body },
    data,
    target_channel: 'push',
    send_after: new Date(sendAt).toISOString(),
    buttons: [
      { id: 'complete', text: '✅ Done' },
      { id: 'remind_later', text: '🔔 Remind Later' },
    ],
  };
  console.log(`[scheduleGoalNotifications] OneSignal payload: ${JSON.stringify(payload).substring(0, 400)}`);
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await res.text();
  console.log(`[scheduleGoalNotifications] OneSignal response: status=${res.status}, body=${responseText.substring(0, 300)}`);
  if (!res.ok) {
    throw new Error(`OneSignal API error: ${res.status} ${responseText}`);
  }
  let json;
  try { json = JSON.parse(responseText); } catch (_) { json = {}; }
  const notifId = json?.id || null;
  console.log(`[scheduleGoalNotifications] Notification scheduled with id=${notifId}`);
  return notifId;
}

// Parse "Month 1 Week 2" or "Month 1, Week 2" -> { month: 1, week: 2 }
// Parse "Month 3" -> { month: 3, week: null }
function parsePhase(phase) {
  if (!phase) {
    console.log(`[scheduleGoalNotifications] parsePhase: null/empty phase`);
    return null;
  }
  const full = phase.match(/Month\s+(\d+)[,\s]+Week\s+(\d+)/i);
  if (full) {
    const result = { month: parseInt(full[1]), week: parseInt(full[2]) };
    console.log(`[scheduleGoalNotifications] parsePhase("${phase}") => month=${result.month}, week=${result.week}`);
    return result;
  }
  const monthOnly = phase.match(/Month\s+(\d+)/i);
  if (monthOnly) {
    const result = { month: parseInt(monthOnly[1]), week: null };
    console.log(`[scheduleGoalNotifications] parsePhase("${phase}") => month=${result.month}, week=null`);
    return result;
  }
  console.log(`[scheduleGoalNotifications] parsePhase("${phase}") => NO MATCH`);
  return null;
}

// Return a UTC Date for localHour:localMin on the given YYYY-MM-DD string
// tzOffsetMinutes is the negative offset from UTC (e.g., -300 for CDT)
function localTimeOnDate(dateStr, localHour, localMin, tzOffsetMinutes) {
   // Create a UTC date at midnight on the given date
   const d = new Date(dateStr + 'T00:00:00Z');
   // Convert local time to UTC: if it's 9 AM local and offset is -300 (CDT, UTC-5),
   // then 9 AM local = 9:00 + 5:00 = 14:00 UTC
   const totalLocalMins = localHour * 60 + localMin;
   const totalUTCMins = totalLocalMins - tzOffsetMinutes;
   d.setUTCHours(Math.floor(totalUTCMins / 60), totalUTCMins % 60, 0, 0);
   console.log(`[scheduleGoalNotifications] localTimeOnDate(${dateStr}, ${localHour}:${localMin}, tzOffset=${tzOffsetMinutes}min) => ${d.toISOString()}`);
   return d;
}

// Add N days to a YYYY-MM-DD string, return new YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  console.log(`[scheduleGoalNotifications] ===== FUNCTION INVOKED =====`);
  console.log(`[scheduleGoalNotifications] Method: ${req.method}, URL: ${req.url}`);

  let rawBody = '';
  try {
    rawBody = await req.text();
    console.log(`[scheduleGoalNotifications] Raw body length: ${rawBody.length}`);
    console.log(`[scheduleGoalNotifications] Raw body preview: ${rawBody.substring(0, 500)}`);
  } catch (bodyErr) {
    console.error(`[scheduleGoalNotifications] Failed to read body: ${bodyErr.message}`);
    return Response.json({ error: 'Failed to read body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (parseErr) {
    console.error(`[scheduleGoalNotifications] Failed to parse JSON: ${parseErr.message}`);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { goal_id, goal_data, timezoneOffsetMinutes } = parsedBody;
  console.log(`[scheduleGoalNotifications] goal_id=${goal_id}, has_goal_data=${!!goal_data}, timezoneOffsetMinutes=${timezoneOffsetMinutes}`);

  if (!goal_id) return Response.json({ error: 'goal_id required' }, { status: 400 });

  let tzOffset = typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : 0;
   console.log(`[scheduleGoalNotifications] Using tzOffset=${tzOffset} (initial)`);
   const now = new Date();
   console.log(`[scheduleGoalNotifications] now=${now.toISOString()}, local time check: tzOffset=${tzOffset}min`);

  let base44;
  try {
    const reqWithBody = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: rawBody,
    });
    base44 = createClientFromRequest(reqWithBody);
    console.log(`[scheduleGoalNotifications] SDK client created`);
  } catch (sdkErr) {
    console.error(`[scheduleGoalNotifications] SDK init failed: ${sdkErr.message}`);
    return Response.json({ error: `SDK init failed: ${sdkErr.message}` }, { status: 500 });
  }

  let goal = goal_data;
  if (!goal) {
    console.log(`[scheduleGoalNotifications] No goal_data passed, fetching from DB...`);
    try {
      goal = await base44.entities.Goal.get(goal_id);
      console.log(`[scheduleGoalNotifications] Fetched goal: id=${goal?.id}, title="${goal?.title}"`);
    } catch (fetchErr) {
      console.error(`[scheduleGoalNotifications] Failed to fetch goal: ${fetchErr.message}`);
      return Response.json({ error: `Failed to fetch goal: ${fetchErr.message}` }, { status: 500 });
    }
    if (!goal) return Response.json({ error: 'Goal not found' }, { status: 404 });
  } else {
    console.log(`[scheduleGoalNotifications] Using passed goal_data: id=${goal?.id}, title="${goal?.title}"`);
  }

  if (typeof goal?.timezone_offset_minutes === 'number') {
    tzOffset = goal.timezone_offset_minutes;
    console.log(`[scheduleGoalNotifications] tzOffset overridden from goal.timezone_offset_minutes=${tzOffset}`);
  }

  let user;
  try {
    user = await base44.auth.me();
    console.log(`[scheduleGoalNotifications] Auth: user=${user?.email}, role=${user?.role}`);
  } catch (authErr) {
    console.error(`[scheduleGoalNotifications] Auth failed: ${authErr.message}`);
    return Response.json({ error: `Auth failed: ${authErr.message}` }, { status: 401 });
  }

  const externalId = user?.email;
  if (!externalId) {
    console.error(`[scheduleGoalNotifications] No user email found`);
    return Response.json({ error: 'No user email' }, { status: 400 });
  }
  console.log(`[scheduleGoalNotifications] externalId=${externalId}`);
  console.log(`[scheduleGoalNotifications] goal.requires_daily_action=${goal.requires_daily_action}, goal.weekdays_only=${goal.weekdays_only}, goal.notification_frequency=${goal.notification_frequency}`);

  let steps;
  try {
    steps = await base44.entities.GoalStep.filter({ goal_id });
    console.log(`[scheduleGoalNotifications] Fetched ${steps.length} steps for goal ${goal_id}`);
    if (steps.length > 0) {
      console.log(`[scheduleGoalNotifications] Step phases sample: ${steps.slice(0, 10).map(s => s.phase).join(' | ')}`);
      console.log(`[scheduleGoalNotifications] Daily habit steps: ${steps.filter(s => s.is_daily_habit).length}`);
      console.log(`[scheduleGoalNotifications] Steps with due_date: ${steps.filter(s => s.due_date).length}`);
    }
  } catch (stepsErr) {
    console.error(`[scheduleGoalNotifications] Failed to fetch steps: ${stepsErr.message}`);
    return Response.json({ error: `Failed to fetch steps: ${stepsErr.message}` }, { status: 500 });
  }

  // Preferred time: the goal's own time wins (set from the planning chat), then the
  // user-level preference, then a 9 AM default.
  let prefHour = 9, prefMin = 0;
  const prefTimeStr = goal.preferred_time || user?.preferred_notification_time;
  if (prefTimeStr) {
    const tp = String(prefTimeStr).match(/(\d{1,2}):(\d{2})/);
    if (tp) { prefHour = parseInt(tp[1]); prefMin = parseInt(tp[2]); }
  }
  console.log(`[scheduleGoalNotifications] prefHour=${prefHour}, prefMin=${prefMin} (source: ${goal.preferred_time ? 'goal' : (user?.preferred_notification_time ? 'user' : 'default')})`);

  let scheduled = 0, cancelled = 0;

  // ── DETECT PLAN START DATE (earliest due_date across all steps) ──
  const allDueDates = steps.filter(s => s.due_date).map(s => s.due_date).sort();
  const planStartDate = allDueDates[0] || null;
  const todayStr = now.toISOString().split('T')[0];
  const planStartsInFuture = planStartDate && planStartDate > todayStr;
  console.log(`[scheduleGoalNotifications] planStartDate=${planStartDate}, todayStr=${todayStr}, planStartsInFuture=${planStartsInFuture}`);

  // ── STEP-LEVEL NOTIFICATIONS (Week 1 only) ──
  console.log(`[scheduleGoalNotifications] --- Processing Week 1 steps for due-date notifications ---`);
  for (const step of steps) {
    const p = parsePhase(step.phase);
    const isWeek1 = p && p.month === 1 && p.week === 1;
    if (!isWeek1) {
      console.log(`[scheduleGoalNotifications] Skipping step "${step.title?.substring(0,40)}" (phase="${step.phase}") — not Week 1`);
      continue;
    }
    
    // Ensure Week 1 steps have due_dates anchored to planStartDate
    if (!step.due_date && planStartDate) {
      const dayIndex = steps.filter(s => {
        const sp = parsePhase(s.phase);
        return sp && sp.month === 1 && sp.week === 1 && !s.due_date;
      }).indexOf(step);
      const generatedDueDate = addDays(planStartDate, dayIndex % 7);
      console.log(`[scheduleGoalNotifications] Week 1 step "${step.title?.substring(0,40)}" has no due_date — using generated date: ${generatedDueDate}`);
      step.due_date = generatedDueDate;
    }
    const existingIds = step.onesignal_notification_ids || [];
    if (existingIds.length > 0) {
      console.log(`[scheduleGoalNotifications] Cancelling ${existingIds.length} old notifs for step "${step.title}"`);
    }
    for (const nid of existingIds) { await cancelNotification(nid); cancelled++; }

    const newNotifIds = [];
    const hasDueDate = !!step.due_date;
    const isDailyHabit = step.is_daily_habit === true;
    console.log(`[scheduleGoalNotifications] Step "${step.title?.substring(0,50)}": phase="${step.phase}", due_date=${step.due_date}, is_daily_habit=${isDailyHabit}, will_schedule_due_date=${hasDueDate && !isDailyHabit}`);

    if (step.due_date && !step.is_daily_habit) {
      // Day-before reminder
      const dayBeforeStr = addDays(step.due_date, -1);
      const dayBeforeSendAt = localTimeOnDate(dayBeforeStr, prefHour, prefMin, tzOffset);
      console.log(`[scheduleGoalNotifications] Day-before sendAt=${dayBeforeSendAt.toISOString()}, now=${now.toISOString()}, isFuture=${dayBeforeSendAt > now}`);
      if (dayBeforeSendAt > now) {
        try {
          const nid = await scheduleNotification({
            externalId,
            title: `📌 "${step.title}" is due tomorrow`,
            body: `Get a head start on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_tomorrow', goal_id: goal.id, step_id: step.id },
            sendAt: dayBeforeSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        } catch (nErr) {
          console.error(`[scheduleGoalNotifications] Failed to schedule day-before for step "${step.title}": ${nErr.message}`);
        }
      }

      // Due-date reminder
      const dueSendAt = localTimeOnDate(step.due_date, prefHour, prefMin, tzOffset);
      console.log(`[scheduleGoalNotifications] Due-date sendAt=${dueSendAt.toISOString()}, isFuture=${dueSendAt > now}`);
      if (dueSendAt > now) {
        try {
          const nid = await scheduleNotification({
            externalId,
            title: `🎯 "${step.title}" is due today`,
            body: `Time to work on this step for ${goal.title}`,
            data: { screen: 'GoalStepNotification', action: 'goal_step_due', goal_id: goal.id, step_id: step.id },
            sendAt: dueSendAt.toISOString(),
          });
          if (nid) { newNotifIds.push(nid); scheduled++; }
        } catch (nErr) {
          console.error(`[scheduleGoalNotifications] Failed to schedule due-date for step "${step.title}": ${nErr.message}`);
        }
      }
    }

    if (newNotifIds.length > 0 || existingIds.length > 0) {
      try {
        await base44.entities.GoalStep.update(step.id, { onesignal_notification_ids: newNotifIds });
        console.log(`[scheduleGoalNotifications] Updated step "${step.title?.substring(0,40)}" with ${newNotifIds.length} notif IDs`);
      } catch (updateErr) {
        console.error(`[scheduleGoalNotifications] Failed to update step notif IDs: ${updateErr.message}`);
      }
    }
  }

  // ── GOAL TYPE DETECTION ──
  const isMilestoneGoal = !steps.some(s => s.is_daily_habit && s.habit_time);
  console.log(`[scheduleGoalNotifications] isMilestoneGoal=${isMilestoneGoal}`);

  // ── CANCEL OLD GOAL-LEVEL NOTIFICATIONS ──
  const existingGoalNotifIds = goal.onesignal_notification_ids || [];
  console.log(`[scheduleGoalNotifications] Cancelling ${existingGoalNotifIds.length} old goal-level notif IDs`);
  for (const nid of existingGoalNotifIds) { await cancelNotification(nid); cancelled++; }
  const goalNotifIds = [];

  // ── BUILD WEEK/MONTH MAP ──
  console.log(`[scheduleGoalNotifications] --- Building weekMap/monthMap ---`);
  const weekMap = {};
  const monthMap = {};

  for (const step of steps) {
    const p = parsePhase(step.phase);
    if (!p) {
      console.log(`[scheduleGoalNotifications] Skipping step "${step.title?.substring(0,40)}" — parsePhase returned null for phase="${step.phase}"`);
      continue;
    }

    // Use step.due_date, or generate one for Month 1 Week 1 steps
    let effectiveDueDate = step.due_date;
    if (!effectiveDueDate && p.month === 1 && p.week === 1 && planStartDate) {
      // Spread Month 1 Week 1 steps across the first week starting from planStartDate
      const dayIndex = steps.filter(s => {
        const sp = parsePhase(s.phase);
        return sp && sp.month === 1 && sp.week === 1 && !s.due_date;
      }).indexOf(step);
      effectiveDueDate = addDays(planStartDate, dayIndex % 7);
      console.log(`[scheduleGoalNotifications] Generated due_date for Month 1 Week 1 step "${step.title?.substring(0,40)}": ${effectiveDueDate}`);
    }

    if (!effectiveDueDate) {
      console.log(`[scheduleGoalNotifications] Skipping step "${step.title?.substring(0,40)}" — no due_date and not Month 1 Week 1`);
      continue;
    }

    const mk = String(p.month);
    if (!monthMap[mk]) monthMap[mk] = { month: p.month, dates: [] };
    monthMap[mk].dates.push(effectiveDueDate);

    if (p.week !== null) {
      const wk = `${p.month}-${p.week}`;
      if (!weekMap[wk]) weekMap[wk] = { month: p.month, week: p.week, dates: [], titles: [] };
      weekMap[wk].dates.push(effectiveDueDate);
      if (step.title) weekMap[wk].titles.push(step.title);
    }
  }

  console.log(`[scheduleGoalNotifications] weekMap keys: [${Object.keys(weekMap).join(', ')}]`);
  console.log(`[scheduleGoalNotifications] monthMap keys: [${Object.keys(monthMap).join(', ')}]`);

  // ── IMMEDIATE "PLAN STARTS SOON" NOTIFICATION (when plan starts in the future) ──
  if (planStartsInFuture) {
    const startDateObj = new Date(planStartDate + 'T00:00:00Z');
    const monthName = startDateObj.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    const monthTheme1 = goal.month_titles?.['1'] || goal.month_titles?.[1];
    try {
      // Send in 2 minutes so it feels like a real "plan created" confirmation
      const soonAt = new Date(now.getTime() + 2 * 60 * 1000);
      const nid = await scheduleNotification({
        externalId,
        title: `Your plan is ready! 🎉`,
        body: monthTheme1
          ? `"${goal.title}" starts in ${monthName}. First up: "${monthTheme1}". You'll hear from me then!`
          : `"${goal.title}" kicks off in ${monthName}. Get ready — you'll hear from me when it's time to start!`,
        data: { screen: 'GoalDetail', action: 'plan_ready', goal_id: goal.id },
        sendAt: soonAt.toISOString(),
      });
      if (nid) { goalNotifIds.push(nid); scheduled++; }
      console.log(`[scheduleGoalNotifications] Scheduled "plan starts in ${monthName}" notification`);
    } catch (nErr) {
      console.error(`[scheduleGoalNotifications] Failed to schedule plan-starts-soon notification: ${nErr.message}`);
    }
  }

  // ── DAILY HABIT NOTIFICATIONS (Week 1, Plan B: AI-personalized, distinct per day) ──
  if (goal.requires_daily_action) {
    console.log(`[scheduleGoalNotifications] --- Scheduling Week 1 daily reminders (AI-personalized) ---`);

    const week1Habit =
      steps.find(s => { if (s.is_daily_habit !== true) return false; const p = parsePhase(s.phase); return p && p.month === 1 && p.week === 1; })
      || steps.find(s => s.is_daily_habit === true)
      || null;

    if (week1Habit && planStartDate) {
      const todayStr = now.toISOString().split('T')[0];
      const weekStartDate = planStartDate <= todayStr ? addDays(todayStr, 1) : planStartDate;
      const include_weekends = goal.include_weekend_reminders !== false;

      const daysToSchedule = [];
      for (let i = 0; i < 7; i++) {
        const dateStr = addDays(weekStartDate, i);
        const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        if ((!isWeekend || include_weekends) && !dateStr.endsWith('-07-04')) daysToSchedule.push(dateStr);
      }
      console.log(`[scheduleGoalNotifications] Week 1 daily dates: ${daysToSchedule.join(', ')}`);

      const bookTitle = goal.month_titles?.['1'] || goal.month_titles?.[1] || goal.title;

      let dailyMessages = [];
      if (daysToSchedule.length > 0) {
        try {
          const llm = await base44.integrations.Core.InvokeLLM({
            prompt: `Write short daily push-notification reminders for someone working on the goal "${goal.title}".
This week (Month 1, Week 1) they are focused on: ${week1Habit.title}.
Week details: ${(week1Habit.description || '').slice(0, 600)}
They are ONLY on this week's material (${bookTitle}). NO SPOILERS — do not reveal or hint at anything beyond the assigned portion (no later plot points, no ending).
Write EXACTLY ${daysToSchedule.length} DISTINCT messages, one per day, each different in wording and angle (kickoff, momentum, a reflection nudge, encouragement, a tiny tip).
Each message: under 110 characters, warm and specific to ${bookTitle}; no markdown, no links, no surrounding quotes.
Return ONLY JSON: {"messages": ["...", ...]} with exactly ${daysToSchedule.length} strings.`,
            response_json_schema: {
              type: "object",
              properties: { messages: { type: "array", items: { type: "string" } } },
              required: ["messages"]
            }
          });
          let obj = llm;
          if (typeof llm === 'string') { try { obj = JSON.parse(llm); } catch { obj = {}; } }
          else if (llm && !Array.isArray(llm.messages) && (llm.text || llm.content || llm.output)) {
            try { obj = JSON.parse(llm.text || llm.content || llm.output); } catch { obj = llm; }
          }
          if (Array.isArray(obj?.messages)) dailyMessages = obj.messages.filter(m => typeof m === 'string' && m.trim());
          console.log(`[scheduleGoalNotifications] Generated ${dailyMessages.length}/${daysToSchedule.length} daily messages`);
        } catch (genErr) {
          console.error(`[scheduleGoalNotifications] daily message generation failed: ${genErr.message}`);
        }
      }

      const fallbacks = [
        `Time to read ${bookTitle} — even a few pages counts.`,
        `Your daily reading: pick up ${bookTitle} today.`,
        `Keep the momentum on ${bookTitle} — read a bit now.`,
        `A little progress in ${bookTitle} today adds up.`,
        `Reading time! Dive back into ${bookTitle}.`,
        `Don't break the streak — read ${bookTitle} today.`,
        `Carve out a few minutes for ${bookTitle}.`,
      ];

      const habitTime = week1Habit.habit_time || `${prefHour}:${String(prefMin).padStart(2, '0')}`;
      const [hh, mm] = habitTime.split(':').map(Number);

      for (let di = 0; di < daysToSchedule.length; di++) {
        const dateStr = daysToSchedule[di];
        const sendAt = localTimeOnDate(dateStr, hh, mm, tzOffset);
        if (sendAt <= now) continue;
        const body = dailyMessages[di] || fallbacks[di % fallbacks.length];
        try {
          const nid = await scheduleNotification({
            externalId,
            title: bookTitle,
            body,
            data: { screen: 'GoalDetail', action: 'daily_habit', goal_id: goal.id, step_id: week1Habit.id, date: dateStr },
            sendAt: sendAt.toISOString(),
          });
          if (nid) { goalNotifIds.push(nid); scheduled++; }
        } catch (nErr) {
          console.error(`[scheduleGoalNotifications] Failed to schedule daily for ${dateStr}: ${nErr.message}`);
        }
      }
    }
  }

  // ── WEEK NOTIFICATIONS (Week 1 only) ──
   console.log(`[scheduleGoalNotifications] --- Scheduling Week 1 notifications ---`);
   for (const [wk, wData] of Object.entries(weekMap)) {
     console.log(`[scheduleGoalNotifications] weekMap[${wk}]: month=${wData.month}, week=${wData.week}, dates=${wData.dates.join(',')}`);
     if (wData.month !== 1 || wData.week !== 1) {
       console.log(`[scheduleGoalNotifications] Skipping week ${wk} — not Month 1 Week 1`);
       continue;
     }

     const sortedDates = [...wData.dates].sort();
     // Week 1 starts on the earliest due_date of Month 1 Week 1 steps (not 6 days before end)
     const weekStartDate = sortedDates[0];
     const weekEndDate = sortedDates[sortedDates.length - 1];
     console.log(`[scheduleGoalNotifications] Week 1: startDate=${weekStartDate}, endDate=${weekEndDate}`);

     const monthTheme = goal.month_titles?.[wData.month] || goal.month_titles?.[String(wData.month)];
     const weekFocus = wData.titles.slice(0, 2).join(' & ') || monthTheme || goal.title;
     console.log(`[scheduleGoalNotifications] Week 1 monthTheme="${monthTheme}", weekFocus="${weekFocus}"`);

     // Week begin — skip if goal requires daily action (plan start already covers it)
     if (!goal.requires_daily_action) {
       const weekBeginSendAt = localTimeOnDate(weekStartDate, prefHour, prefMin, tzOffset);
       console.log(`[scheduleGoalNotifications] Week begin sendAt=${weekBeginSendAt.toISOString()}, isFuture=${weekBeginSendAt > now}`);
       if (weekBeginSendAt > now) {
         try {
           const nid = await scheduleNotification({
             externalId,
             title: `Week 1 begins! 🚀`,
             body: monthTheme
               ? `"${monthTheme}" starts now. Focus this week: ${weekFocus}`
               : `Week 1 of "${goal.title}" starts now. This week: ${weekFocus}`,
             data: { screen: 'GoalDetail', action: 'week_begin', goal_id: goal.id, month: wData.month, week: wData.week },
             sendAt: weekBeginSendAt.toISOString(),
           });
           if (nid) { goalNotifIds.push(nid); scheduled++; }
         } catch (nErr) {
           console.error(`[scheduleGoalNotifications] Failed to schedule week begin: ${nErr.message}`);
         }
       }
     }

     // Week end
     const weekEndSendAt = localTimeOnDate(weekEndDate, prefHour, prefMin, tzOffset);
     console.log(`[scheduleGoalNotifications] Week end sendAt=${weekEndSendAt.toISOString()}, isFuture=${weekEndSendAt > now}`);
     if (weekEndSendAt > now) {
       try {
         const nid = await scheduleNotification({
           externalId,
           title: `Week 1 wrap-up 🏁`,
           body: monthTheme
             ? `Week 1 of "${monthTheme}" is done. How did it go? Check your progress.`
             : `Week 1 of "${goal.title}" is wrapping up. Reflect on what you accomplished.`,
           data: { screen: 'GoalDetail', action: 'week_end', goal_id: goal.id, month: wData.month, week: wData.week },
           sendAt: weekEndSendAt.toISOString(),
         });
         if (nid) { goalNotifIds.push(nid); scheduled++; }
       } catch (nErr) {
         console.error(`[scheduleGoalNotifications] Failed to schedule week end: ${nErr.message}`);
       }
     }
   }

  // Save goal-level notification IDs
  try {
    await base44.entities.Goal.update(goal.id, { onesignal_notification_ids: goalNotifIds });
    console.log(`[scheduleGoalNotifications] Saved ${goalNotifIds.length} goal-level notif IDs to goal`);
  } catch (updateErr) {
    console.error(`[scheduleGoalNotifications] Failed to save goal notif IDs: ${updateErr.message}`);
  }

  console.log(`[scheduleGoalNotifications] ===== COMPLETE: scheduled=${scheduled}, cancelled=${cancelled}, steps_processed=${steps.length} =====`);
  return Response.json({ ok: true, scheduled, cancelled, steps_processed: steps.length });
});