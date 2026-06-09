import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  console.log(`[createRemainingGoalSteps] ===== FUNCTION INVOKED =====`);
  console.log(`[createRemainingGoalSteps] Method: ${req.method}`);
  console.log(`[createRemainingGoalSteps] URL: ${req.url}`);
  console.log(`[createRemainingGoalSteps] Headers: ${JSON.stringify(Object.fromEntries(req.headers.entries()))}`);

  let rawBody = '';
  try {
    rawBody = await req.text();
    console.log(`[createRemainingGoalSteps] Raw body length: ${rawBody.length}`);
    console.log(`[createRemainingGoalSteps] Raw body preview: ${rawBody.substring(0, 500)}`);
  } catch (bodyErr) {
    console.error(`[createRemainingGoalSteps] Failed to read body: ${bodyErr.message}`);
    return Response.json({ error: 'Failed to read body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
    console.log(`[createRemainingGoalSteps] Parsed body keys: ${Object.keys(parsedBody).join(', ')}`);
  } catch (parseErr) {
    console.error(`[createRemainingGoalSteps] Failed to parse JSON: ${parseErr.message}`);
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { goal_id, steps, start_order_index = 0, timezoneOffsetMinutes } = parsedBody;

  console.log(`[createRemainingGoalSteps] goal_id=${goal_id}, steps count=${Array.isArray(steps) ? steps.length : 'NOT_ARRAY (type=' + typeof steps + ')'}, start_order_index=${start_order_index}`);

  if (steps && Array.isArray(steps) && steps.length > 0) {
    console.log(`[createRemainingGoalSteps] First step sample: ${JSON.stringify(steps[0]).substring(0, 300)}`);
    console.log(`[createRemainingGoalSteps] Step phases: ${steps.map(s => s.phase).join(' | ')}`);
  }

  if (!goal_id || !steps || !Array.isArray(steps) || steps.length === 0) {
    console.log(`[createRemainingGoalSteps] VALIDATION FAILED: goal_id=${!!goal_id}, steps_is_array=${Array.isArray(steps)}, steps_length=${steps?.length}`);
    return Response.json({ error: 'goal_id and steps required' }, { status: 400 });
  }

  let base44;
  try {
    // Re-create the request with the already-read body since we consumed it
    const reqWithBody = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: rawBody,
    });
    base44 = createClientFromRequest(reqWithBody);
    console.log(`[createRemainingGoalSteps] SDK client created successfully`);
  } catch (sdkErr) {
    console.error(`[createRemainingGoalSteps] SDK client creation failed: ${sdkErr.message}`);
    return Response.json({ error: `SDK init failed: ${sdkErr.message}` }, { status: 500 });
  }

  // Test auth
  try {
    const user = await base44.auth.me();
    console.log(`[createRemainingGoalSteps] Auth check: user=${user?.email || 'NULL'}, role=${user?.role || 'NULL'}`);
  } catch (authErr) {
    console.error(`[createRemainingGoalSteps] Auth check failed: ${authErr.message}`);
    // Don't block — we use asServiceRole below, so auth failure is non-fatal
  }

  // Test service role works at all
  try {
    const testGoal = await base44.asServiceRole.entities.Goal.list('-created_date', 1);
    console.log(`[createRemainingGoalSteps] asServiceRole sanity check OK — can list goals. Count test: ${testGoal.length}`);
  } catch (srErr) {
    console.error(`[createRemainingGoalSteps] asServiceRole sanity check FAILED: ${srErr.message}`);
    return Response.json({ error: `Service role failed: ${srErr.message}` }, { status: 500 });
  }

  // Fetch start_date from the goal so due_dates are anchored to the user's chosen start
  let goal_start_date = null;
  try {
    const _g = (await base44.asServiceRole.entities.Goal.filter({ id: goal_id }))[0];
    goal_start_date = _g?.start_date || null;
    console.log(`[createRemainingGoalSteps] goal_start_date=${goal_start_date}`);
  } catch (_) {}

  // Build bulk payload — much faster than one-by-one and avoids timeouts for large plans
  const bulkPayload = steps.map((step, i) => ({
    goal_id,
    title: step.title,
    description: step.description || "",
    phase: step.phase || "",
    priority: step.priority || "medium",
    due_date: (() => {
      if (goal_start_date) {
        const m = (step.phase || '').match(/Month\s*(\d+)[,\s]+Week\s*(\d+)/i);
        // 1-indexed cumulative week across the whole plan (Month 1 Week 1 = 1).
        const weekNum = m ? (parseInt(m[1]) - 1) * 4 + parseInt(m[2]) : (i + 1);
        const d = new Date(goal_start_date + 'T00:00:00Z');
        if (weekNum > 1) {
          // CALENDAR-WEEK alignment: Week 1 = the start date (partial first week, ends that Sunday);
          // Week 2 = Monday of the NEXT calendar week; Week N = that Monday + (N-2) weeks.
          const dow = d.getUTCDay();                          // 0=Sun .. 6=Sat
          const daysToFirstMonday = ((1 - dow + 7) % 7) || 7; // start → next calendar week's Monday
          d.setUTCDate(d.getUTCDate() + daysToFirstMonday + (weekNum - 2) * 7);
        }
        return d.toISOString().split('T')[0];
      }
      return step.due_date || "";
    })(),
    order_index: step.order_index ?? (start_order_index + i),
    status: "pending",
    step_resources: step.step_resources || [],
    success_criteria: step.success_criteria || [],
    tips_and_guidance: step.tips_and_guidance || "",
    is_daily_habit: step.is_daily_habit === true
  }));

  console.log(`[createRemainingGoalSteps] Bulk creating ${bulkPayload.length} steps...`);
  let createdCount = 0;
  let failedSteps = [];

  // Use user-scoped client so created_by is set to the actual user (required by read RLS)
  try {
    await base44.entities.GoalStep.bulkCreate(bulkPayload);
    createdCount = bulkPayload.length;
    console.log(`[createRemainingGoalSteps] Bulk create SUCCESS: ${createdCount} steps`);
  } catch (bulkErr) {
    console.error(`[createRemainingGoalSteps] Bulk create FAILED: ${bulkErr.message} — falling back to one-by-one`);
    for (let i = 0; i < bulkPayload.length; i++) {
      try {
        await base44.entities.GoalStep.create(bulkPayload[i]);
        createdCount++;
      } catch (stepErr) {
        console.error(`[createRemainingGoalSteps] Step ${i + 1} FAILED: ${stepErr.message}`);
        failedSteps.push({ index: i, title: steps[i].title, phase: steps[i].phase, error: stepErr.message });
      }
    }
  }

  console.log(`[createRemainingGoalSteps] ===== DONE: created=${createdCount}/${steps.length}, failed=${failedSteps.length} =====`);

  // Now that steps exist in DB, schedule notifications in background (don't await)
  if (createdCount > 0) {
    base44.functions.invoke('scheduleGoalNotifications', {
      goal_id,
      timezoneOffsetMinutes: timezoneOffsetMinutes ?? 0
    }).catch(notifErr => console.error(`[createRemainingGoalSteps] scheduleGoalNotifications failed: ${notifErr.message}`));
  }

  return Response.json({ ok: true, created: createdCount, total: steps.length, failed: failedSteps.length, failed_details: failedSteps });
});