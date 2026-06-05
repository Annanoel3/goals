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

  const { goal_id, steps, start_order_index = 0 } = parsedBody;
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

  let createdCount = 0;
  const failedSteps = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[createRemainingGoalSteps] Creating step ${i + 1}/${steps.length}: phase="${step.phase}", title="${step.title?.substring(0, 60)}"`);

    try {
      const payload = {
        goal_id,
        title: step.title,
        description: step.description || "",
        phase: step.phase || "",
        priority: step.priority || "medium",
        due_date: step.due_date || "",
        order_index: step.order_index ?? (start_order_index + i),
        status: "pending",
        step_resources: step.step_resources || [],
        success_criteria: step.success_criteria || [],
        tips_and_guidance: step.tips_and_guidance || "",
        is_daily_habit: step.is_daily_habit === true
      };
      console.log(`[createRemainingGoalSteps] Step ${i + 1} payload (partial): goal_id=${payload.goal_id}, phase=${payload.phase}, order_index=${payload.order_index}`);

      const createdStep = await base44.asServiceRole.entities.GoalStep.create(payload);
      console.log(`[createRemainingGoalSteps] Step ${i + 1} CREATED with id=${createdStep?.id}`);

      if (step.sub_steps?.length > 0) {
        console.log(`[createRemainingGoalSteps] Step ${i + 1} has ${step.sub_steps.length} sub-steps`);
        for (let j = 0; j < step.sub_steps.length; j++) {
          const subStep = step.sub_steps[j];
          try {
            await base44.asServiceRole.entities.GoalStep.create({
              goal_id,
              parent_step_id: createdStep.id,
              title: subStep.title,
              description: subStep.description || "",
              phase: step.phase || "",
              priority: subStep.priority || "low",
              due_date: subStep.due_date || "",
              order_index: j,
              status: "pending"
            });
            console.log(`[createRemainingGoalSteps] Sub-step ${j + 1}/${step.sub_steps.length} created`);
          } catch (subErr) {
            console.error(`[createRemainingGoalSteps] Sub-step ${j + 1} failed: ${subErr.message}`);
          }
        }
      }

      createdCount++;
    } catch (stepErr) {
      console.error(`[createRemainingGoalSteps] STEP ${i + 1} FAILED: "${step.title}" — ${stepErr.message}`);
      console.error(`[createRemainingGoalSteps] STEP ${i + 1} FULL ERROR: ${JSON.stringify(stepErr)}`);
      failedSteps.push({ index: i, title: step.title, phase: step.phase, error: stepErr.message });
    }
  }

  console.log(`[createRemainingGoalSteps] ===== DONE: created=${createdCount}/${steps.length}, failed=${failedSteps.length} =====`);
  if (failedSteps.length > 0) {
    console.error(`[createRemainingGoalSteps] FAILED STEPS: ${JSON.stringify(failedSteps)}`);
  }

  return Response.json({ ok: true, created: createdCount, total: steps.length, failed: failedSteps.length, failed_details: failedSteps });
});