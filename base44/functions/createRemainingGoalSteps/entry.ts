import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { goal_id, steps } = await req.json();
    
    if (!goal_id || !steps || steps.length === 0) {
      return Response.json({ error: 'goal_id and steps required' }, { status: 400 });
    }

    // Fetch goal to get timeline for calculating due_dates
    const goal = await base44.asServiceRole.entities.Goal.get(goal_id);
    if (!goal) {
      return Response.json({ error: 'Goal not found' }, { status: 404 });
    }

    // Calculate start date and total days from timeline
    const goalCreatedDate = new Date(goal.created_date);
    const timelineMatch = goal.timeline?.match(/(\d+)\s*month/i);
    const totalMonths = timelineMatch ? parseInt(timelineMatch[1]) : 3;
    const totalDays = totalMonths * 30; // Approximate

    // Calculate due_date for each step based on order_index distribution
    const stepsWithDates = steps.map((step, idx) => {
      // If step already has a due_date, keep it
      if (step.due_date) return step;
      
      // Calculate due_date by distributing steps evenly across timeline
      const progressRatio = (idx + 1) / steps.length;
      const daysFromStart = Math.ceil(progressRatio * totalDays);
      const dueDate = new Date(goalCreatedDate);
      dueDate.setDate(dueDate.getDate() + daysFromStart);
      
      return {
        ...step,
        due_date: dueDate.toISOString().split('T')[0] // YYYY-MM-DD format
      };
    });

    let createdCount = 0;
    for (const step of stepsWithDates) {
      try {
        const createdStep = await base44.asServiceRole.entities.GoalStep.create({
          goal_id,
          title: step.title,
          description: step.description || "",
          phase: step.phase || "",
          priority: step.priority || "medium",
          due_date: step.due_date || "",
          order_index: step.order_index ?? 0,
          status: "pending",
          step_resources: step.step_resources || [],
          success_criteria: step.success_criteria || [],
          tips_and_guidance: step.tips_and_guidance || "",
          is_daily_habit: step.is_daily_habit === true
        });

        // Create sub-steps if provided
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
      } catch (stepErr) {
        console.error(`Failed to create step "${step.title}":`, stepErr.message);
      }
    }

    return Response.json({ ok: true, created: createdCount, total: steps.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});