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

  // Build bulk payload — much faster than one-by-one and avoids timeouts for large plans
  const bulkPayload = steps.map((step, i) => ({
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

  // Assign due_dates to steps based on phase if not already set
  console.log(`[createRemainingGoalSteps] Calculating due_dates for steps based on phases...`);
  if (createdCount > 0) {
    try {
      const goal = await base44.entities.Goal.get(goal_id);
      const targetDate = goal?.target_date ? new Date(goal.target_date + 'T00:00:00Z') : null;
      const timelineStr = goal?.timeline || '';
      
      // Detect total months from timeline (e.g., "12 months", "7-month plan")
      const timelineMatch = timelineStr.match(/(\d+)/);
      const totalMonths = timelineMatch ? parseInt(timelineMatch[1]) : 12;
      
      if (targetDate && totalMonths > 0) {
        // Calculate start date from target and total months
        const startDate = new Date(targetDate);
        startDate.setUTCMonth(startDate.getUTCMonth() - totalMonths);
        console.log(`[createRemainingGoalSteps] Goal timeline: ${totalMonths} months, startDate=${startDate.toISOString().split('T')[0]}, targetDate=${targetDate.toISOString().split('T')[0]}`);
        
        // Assign due_dates to all created steps
        const updatedSteps = bulkPayload.map(step => {
          if (step.due_date) return step; // Skip if already has a due_date
          
          // Parse phase to get month/week
          const phaseMatch = step.phase.match(/Month\s+(\d+)(?:[,\s]+Week\s+(\d+))?/i);
          if (!phaseMatch) return step;
          
          const monthNum = parseInt(phaseMatch[1]);
          const weekNum = phaseMatch[2] ? parseInt(phaseMatch[2]) : 1;
          
          // Calculate due date: startDate + (monthNum-1)*30 days + (weekNum-1)*7 days
          const dayOffset = (monthNum - 1) * 30 + (weekNum - 1) * 7;
          const stepDueDate = new Date(startDate);
          stepDueDate.setUTCDate(stepDueDate.getUTCDate() + dayOffset);
          
          const dueDateStr = stepDueDate.toISOString().split('T')[0];
          console.log(`[createRemainingGoalSteps] Step "${step.title?.substring(0,30)}" phase="${step.phase}" => due_date=${dueDateStr}`);
          
          return { ...step, due_date: dueDateStr };
        });
        
        // Update created steps with calculated due_dates
        for (const step of updatedSteps) {
          if (step.due_date && step.due_date !== bulkPayload.find(s => s.title === step.title)?.due_date) {
            try {
              await base44.asServiceRole.entities.GoalStep.update(
                bulkPayload.findIndex(s => s.title === step.title),
                { due_date: step.due_date }
              );
            } catch (err) {
              // Silently fail — steps are created, due_dates are a bonus
              console.error(`[createRemainingGoalSteps] Failed to update due_date for step: ${err.message}`);
            }
          }
        }
      }
    } catch (dateCalcErr) {
      console.error(`[createRemainingGoalSteps] Due date calculation failed: ${dateCalcErr.message}`);
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