import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";
import OpenAI from "npm:openai";

Deno.serve(async (req) => {
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, mode, goal_id } = body;

    // ── EXTRACT PLAN: parse conversation into structured JSON ──────────────────
    if (mode === 'extract_plan') {
      const conversationText = messages.map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');
      const today = new Date().toISOString().split('T')[0];

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are extracting a structured goal plan from a planning conversation. Return ONLY valid JSON, no markdown fences.`
          },
          {
            role: "user",
            content: `Extract the FINAL agreed plan from this conversation:

${conversationText}

Return JSON (no markdown) in EXACTLY this structure. IMPORTANT: Create AT LEAST 15-20+ detailed subtasks PER MILESTONE, breaking down the goal into granular actionable steps:
{
  "title": "concise goal title",
  "description": "what the user wants to achieve",
  "timeline": "e.g. 5 months",
  "target_date": "YYYY-MM-DD calculated from today ${today}",
  "category": "one of: learning, health, career, finance, relationships, personal, creative, other",
  "plan_summary": "2-3 sentence summary of the overall plan",
  "steps": [
    {
      "title": "specific, granular subtask (e.g., 'Complete Lesson 2: Present Tense Conjugation')",
      "description": "detailed explanation of what to do and why",
      "phase": "e.g. Month 1, Week 1 (use phases like Month 1, Month 2, etc.)",
      "priority": "low|medium|high|critical",
      "due_date": "YYYY-MM-DD (spread across the timeline, realistic pacing)",
      "order_index": 0,
      "step_resources": [
        {
          "type": "video|book|article|tool|course|website|other",
          "title": "exact name of resource",
          "url": "direct link if available",
          "description": "how to use this resource for this step",
          "specific_details": "specific sections/times/pages/instructions (e.g., 'watch 2:30-5:45', 'read pages 45-52', 'use filter XYZ')"
        }
      ],
      "success_criteria": [
        "measurable indicator (e.g., 'Can play scales at 60 bpm with correct form')",
        "another criterion"
      ],
      "tips_and_guidance": "specific advice, common pitfalls, best practices for this step"
    }
  ]
}

CRITICAL: 
1. Generate 15-20+ steps PER PHASE/MILESTONE, not just a handful total. Make the plan deeply detailed and actionable.
2. FOR EVERY STEP, include step_resources with specific links and guidance (videos, books, articles, tools, websites)
3. FOR EVERY STEP, include measurable success_criteria so users know exactly when they've completed it
4. FOR EVERY STEP, include tips_and_guidance with specific advice and common pitfalls to avoid
5. This removes all excuses — users have everything they need to execute.`
          }
        ],
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);

      // Ensure all steps have required fields
      plan.steps = (plan.steps || []).map(step => ({
        ...step,
        step_resources: step.step_resources || [],
        success_criteria: step.success_criteria || [],
        tips_and_guidance: step.tips_and_guidance || ""
      }));

      // Extract preferred time from conversation for health goals
      let preferredTime = null;
      if (plan.category === 'health') {
        const conversationLower = conversationText.toLowerCase();
        // Look for time patterns like "6 am", "6am", "18:00", "6:00 PM", etc.
        const timeMatch = conversationText.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?|\b(morning|afternoon|evening|night)\b/i);
        if (timeMatch) {
          preferredTime = timeMatch[0].trim();
        }
      }
      
      plan.preferred_time = preferredTime;
      return Response.json({ plan });
    }

    // ── APPLY EDIT: commit approved edits to an existing goal ─────────────────
    if (mode === 'apply_edit') {
      const conversationText = messages.map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');

      // Fetch existing goal & steps for context
      const existingGoal = await base44.asServiceRole.entities.Goal.list().then(all => all.find(g => g.id === goal_id));
      const existingSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });

      const today = new Date().toISOString().split('T')[0];
      const stepsJson = JSON.stringify(existingSteps.map(s => ({
        id: s.id, title: s.title, phase: s.phase, priority: s.priority, due_date: s.due_date, order_index: s.order_index, status: s.status
      })));

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You extract approved goal edits from a conversation. Return ONLY valid JSON, no markdown.`
          },
          {
            role: "user",
            content: `Current goal: ${existingGoal?.title || 'Unknown'}
Current steps: ${stepsJson}

Conversation about edits:
${conversationText}

Extract the APPROVED changes. Return JSON:
{
  "goal_updates": {
    "title": "optional - only if changed",
    "description": "optional - only if changed",
    "plan_summary": "optional - only if changed",
    "timeline": "optional - only if changed",
    "target_date": "YYYY-MM-DD - optional - only if changed"
  },
  "steps_to_add": [
    { "title": "...", "description": "...", "phase": "...", "priority": "low|medium|high|critical", "due_date": "YYYY-MM-DD", "order_index": 999 }
  ],
  "steps_to_update": [
    { "id": "existing step id", "title": "...", "description": "...", "phase": "...", "priority": "...", "due_date": "YYYY-MM-DD" }
  ],
  "steps_to_delete": ["step_id_1", "step_id_2"]
}
Only include fields that actually changed. today = ${today}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const edits = JSON.parse(extractionResponse.choices[0].message.content);

      // Apply goal-level updates
      if (edits.goal_updates && Object.keys(edits.goal_updates).length > 0) {
        await base44.asServiceRole.entities.Goal.update(goal_id, edits.goal_updates);
      }

      // Add new steps
      if (edits.steps_to_add?.length > 0) {
        for (const step of edits.steps_to_add) {
          await base44.asServiceRole.entities.GoalStep.create({
            goal_id,
            title: step.title,
            description: step.description || "",
            phase: step.phase || "",
            priority: step.priority || "medium",
            due_date: step.due_date || "",
            order_index: step.order_index ?? 999,
            status: "pending",
            step_resources: step.step_resources || [],
            success_criteria: step.success_criteria || [],
            tips_and_guidance: step.tips_and_guidance || ""
          });
        }
      }

      // Update existing steps
      if (edits.steps_to_update?.length > 0) {
        for (const step of edits.steps_to_update) {
          const { id, ...updates } = step;
          await base44.asServiceRole.entities.GoalStep.update(id, updates);
        }
      }

      // Delete steps
      if (edits.steps_to_delete?.length > 0) {
        for (const stepId of edits.steps_to_delete) {
          await base44.asServiceRole.entities.GoalStep.delete(stepId);
        }
      }

      return Response.json({ success: true, edits });
    }

    // ── CHAT: main conversational mode ────────────────────────────────────────
    // Load user's existing goals to allow editing by name
    let existingGoalsList = [];
    try {
      existingGoalsList = await base44.asServiceRole.entities.Goal.filter({ created_by: user.email });
    } catch (_) { /* ignore */ }

    const goalsSummary = existingGoalsList.length > 0
      ? `The user has these existing goals:\n${existingGoalsList.map(g => `- ID: ${g.id} | Title: "${g.title}" | Status: ${g.status} | Timeline: ${g.timeline || 'N/A'}`).join('\n')}`
      : 'The user has no existing goals yet.';

    const isEditSession = !!goal_id;

    let systemPrompt;
    if (isEditSession) {
      // Fetch current goal + steps for context
      const currentGoal = existingGoalsList.find(g => g.id === goal_id);
      const currentSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
      const stepsText = currentSteps
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        .map(s => `  [${s.phase || 'No phase'}] ${s.title} (${s.priority}, due: ${s.due_date || 'TBD'}, status: ${s.status})`)
        .join('\n');

      systemPrompt = `You are an expert goal planner helping a user EDIT and EVOLVE an existing goal.

CURRENT GOAL: "${currentGoal?.title || 'Unknown'}"
PLAN SUMMARY: ${currentGoal?.plan_summary || 'N/A'}
TIMELINE: ${currentGoal?.timeline || 'N/A'}

CURRENT STEPS:
${stepsText || '  (no steps yet)'}

Your job:
1. Understand what changes the user wants (add steps, extend timeline, add milestones, change priorities, etc.)
2. Propose the specific changes clearly — show exactly what will be added/changed/removed
3. Ask for confirmation before applying anything
4. NEVER apply changes without explicit user approval (phrases like "yes", "looks good", "do it", "apply it", "perfect", "save it")
5. When approved, start your response with EXACTLY "EDIT_APPROVED" then summarize what was applied
6. Always include milestone phases (Month 1, Month 2, Week 1, etc.)

Be conversational and collaborative. Suggest improvements proactively if you see gaps.`;
    } else {
      systemPrompt = `You are an expert goal planner and life coach. Your job is to help users create brand-new detailed, actionable, realistic goal plans — OR edit their existing goals.

${goalsSummary}

WHEN CREATING A NEW GOAL:
1. Ask clarifying questions (current situation, available time, resources, constraints)
2. FOR HEALTH/FITNESS GOALS: Ask what time of day they prefer to work out/exercise (e.g., "What time works best for your workout? Morning? Evening?")
3. Create a detailed phased plan with milestones (Month 1, Month 2, Week 1, etc.)
4. Include specific, actionable steps — not vague suggestions
5. CRITICAL: For EVERY phase/week, include concrete resources:
   - Video tutorials with actual links (YouTube, Skillshare, Udemy, etc.) with "Click here" links
   - Book recommendations (Amazon links or ISBN)
   - Apps, tools, or free resources
   - This removes excuses — they have everything they need to execute
6. Cover the full timeline with clear phases
7. When user approves (says "looks great", "perfect", "save it", "let's do it", "that works"), start your response with EXACTLY "PLAN_APPROVED" then summarize

WHEN EDITING AN EXISTING GOAL (user mentions a goal by name or asks to adjust):
1. Acknowledge which goal they're talking about
2. Understand exactly what they want changed
3. Propose the specific changes
4. When user approves, start response with EXACTLY "EDIT_APPROVED:<goal_id>" (use the actual ID from the list above)

Always use milestone phases. Be specific, warm, and encouraging.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ]
    });

    const reply = completion.choices[0].message.content;

    // Parse response type
    if (isEditSession && reply.startsWith('EDIT_APPROVED')) {
      return Response.json({ message: reply.replace(/^EDIT_APPROVED\s*/i, ''), action: 'edit_approved', goal_id });
    }
    if (reply.startsWith('PLAN_APPROVED')) {
      return Response.json({ message: reply.replace(/^PLAN_APPROVED\s*/i, ''), action: 'plan_approved' });
    }
    const editMatch = reply.match(/^EDIT_APPROVED:([^\s]+)/i);
    if (editMatch) {
      const editGoalId = editMatch[1];
      return Response.json({ message: reply.replace(/^EDIT_APPROVED:[^\s]+\s*/i, ''), action: 'edit_approved', goal_id: editGoalId });
    }

    return Response.json({ message: reply, action: 'chat' });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});