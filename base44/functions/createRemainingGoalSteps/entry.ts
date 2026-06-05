import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id, steps, start_order_index = 0 } = await req.json();
    console.log(`[createRemainingGoalSteps] Called: goal_id=${goal_id}, steps=${steps?.length}, start_order_index=${start_order_index}`);

    if (!goal_id || !steps || steps.length === 0) {
      console.log(`[createRemainingGoalSteps] Missing required fields`);
      return Response.json({ error: 'goal_id and steps required' }, { status: 400 });
    }

    let createdCount = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const createdStep = await base44.asServiceRole.entities.GoalStep.create({
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
        });

        if (step.sub_steps?.length > 0) {
          for (const subStep of step.sub_steps) {
            await base44.asServiceRole.entities.GoalStep.create({
              goal_id,
              parent_step_id: createdStep.id,
              title: subStep.title,
              description: subStep.description || "",
              phase: step.phase || "",
              priority: subStep.priority || "low",
              due_date: subStep.due_date || "",
              order_index: 0,
              status: "pending"
            });
          }
        }
        createdCount++;
        if (i % 5 === 0) console.log(`[createRemainingGoalSteps] Progress: ${createdCount}/${steps.length} steps created`);
      } catch (stepErr) {
        console.error(`[createRemainingGoalSteps] Failed step "${step.title}":`, stepErr.message);
      }
    }

    console.log(`[createRemainingGoalSteps] Done: created=${createdCount}, total=${steps.length}`);
    return Response.json({ ok: true, created: createdCount, total: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});