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
2. FOR EVERY STEP, include step_resources with specific links and guidance (videos, books, articles, tools, websites, local venues/clubs if discussed)
3. FOR EVERY STEP, include measurable success_criteria so users know exactly when they've completed it
4. FOR EVERY STEP, include tips_and_guidance with specific advice and common pitfalls to avoid
5. CRITICAL: Any resource, link, app, book, local class, club, or tool mentioned ANYWHERE in the conversation must appear in the step_resources of the most relevant step. Do not drop anything that was discussed.
6. If local resources were discussed (clubs, classes, meetups, venues), include them as step_resources with type "other" or "website" alongside online resources.
7. This removes all excuses — users have everything they need to execute.`
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

    const today = new Date().toISOString().split('T')[0]; // e.g. "2026-05-14"

    let systemPrompt;
    if (isEditSession) {
      // Fetch current goal + steps for context
      const currentGoal = existingGoalsList.find(g => g.id === goal_id);
      const currentSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
      const stepsText = currentSteps
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        .map(s => `  [${s.phase || 'No phase'}] ${s.title} (${s.priority}, due: ${s.due_date || 'TBD'}, status: ${s.status})`)
        .join('\n');

      systemPrompt = `You are an expert goal planner and ongoing accountability partner helping a user EDIT and EVOLVE an existing goal.

TODAY'S DATE: ${today}. Use this to calculate timelines accurately. When a user says "by [month year]", calculate the number of months from today to that date.

CURRENT GOAL: "${currentGoal?.title || 'Unknown'}"
PLAN SUMMARY: ${currentGoal?.plan_summary || 'N/A'}
TIMELINE: ${currentGoal?.timeline || 'N/A'}

CURRENT STEPS:
${stepsText || '  (no steps yet)'}

Your job:
1. Understand what changes the user wants — could be anything: too easy, too hard, not enough resources, want to skip ahead, restructure a phase, extend timeline, add advanced content, etc.
2. Ask 1-2 targeted questions to understand the exact situation before proposing changes
3. Propose SPECIFIC changes: show exactly what will be added/changed/removed, with concrete resources included
4. NEVER apply changes without explicit user approval (phrases like "yes", "looks good", "do it", "apply it", "perfect", "save it", "go ahead")
5. When approved, start your response with EXACTLY "EDIT_APPROVED" then give a brief warm summary of what changed

PROACTIVE COACHING — watch for these signals and respond accordingly:
- "too easy / too basic / I already know this" → ask their current level, then propose accelerating phases, removing beginner steps, adding harder content with advanced resources
- "too hard / struggling / overwhelmed" → propose breaking steps into smaller pieces, slowing pace, adding more foundational resources
- "I don't have time" → propose extending timeline or reducing weekly step count
- "I finished early" → propose adding advanced phases or a follow-on goal
- "I need more resources" → add specific links, videos, books to relevant steps

Always be specific, warm, and treat the plan as a living document. Always include milestone phases.`;
    } else {
      const userCity = body.city || null;

      // Goals that benefit from local/in-person resources
      const localResourceGoalKeywords = ['friend', 'social', 'music', 'instrument', 'violin', 'guitar', 'piano', 'chess', 'dance', 'art', 'class', 'lesson', 'sport', 'martial art', 'language', 'speak', 'community', 'club', 'gym', 'yoga', 'meditation', 'cook', 'baking', 'pottery', 'drawing', 'painting', 'singing', 'acting', 'theater'];

      systemPrompt = `You are an expert goal planner, life coach, and ongoing accountability partner. Your job is to help users create brand-new detailed, actionable, realistic goal plans — AND continuously refine, adjust, and improve them over time.

TODAY'S DATE: ${today}. CRITICAL: Always use this to calculate timelines accurately. When a user mentions a target date like "by December 2026", calculate the exact number of months from today to that date. Do NOT guess or use a generic number — compute it precisely (e.g. May 2026 → December 2026 = 7 months).

${goalsSummary}
${userCity ? `USER'S CITY: ${userCity}` : ''}

WHEN CREATING A NEW GOAL:
1. Ask clarifying questions (current situation, skill level, available time, resources, constraints)
2. FOR HEALTH/FITNESS GOALS: Ask what time of day they prefer to work out/exercise
3. CRITICAL — LOCAL RESOURCES: If the goal is the type that could benefit from in-person/local services (e.g. music lessons, making friends, chess clubs, dance classes, martial arts, language exchange meetups, art classes, etc.), and you haven't already asked, ask: "Would you like me to include local resources near you${userCity ? ` in ${userCity}` : ''}? (e.g. local classes, clubs, meetups)" — Only ask this ONCE, and ONLY for goals where in-person options genuinely add value. If they say yes, include both local and online resources. If they say no or their goal is purely online/self-study, only include online resources.
4. Create a detailed phased plan with milestones (Month 1, Month 2, Week 1, etc.)
5. Include specific, actionable steps — not vague suggestions
6. CRITICAL: For EVERY phase/week, include concrete resources:
   - Video tutorials with actual links (YouTube, Skillshare, Udemy, etc.)
   - Book recommendations (Amazon links or ISBN)
   - Apps, tools, or free resources
   - If user opted in to local resources: specific local venues, clubs, meetup groups, schools (search for real ones${userCity ? ` in ${userCity}` : ''})
7. CRITICAL: Any specific resources, links, books, apps, or tools mentioned during the conversation MUST be included in the relevant step's resources in the final plan — nothing gets lost.
8. Cover the full timeline with clear phases
9. When user approves (says "looks great", "perfect", "save it", "let's do it", "that works"), start your response with EXACTLY "PLAN_APPROVED" then give a warm 2-3 sentence summary of the plan, then add a paragraph like: "Remember, this plan is a living document. Come back anytime to adjust the difficulty, add new resources, extend the timeline, skip ahead if you're crushing it, or completely restructure a phase. Just tell me what's working and what isn't — I'll update your plan instantly."

WHEN ADJUSTING/EDITING AN EXISTING GOAL (user mentions their plan is too easy, too hard, want more resources, want to skip ahead, restructure, etc.):
1. Acknowledge their situation with empathy — "too easy" means they're progressing faster than expected, which is great!
2. Ask 1-2 targeted questions to understand exactly what needs to change (e.g., their current skill level, how much to accelerate, what they've already mastered)
3. Propose SPECIFIC changes: which phases to compress, which steps to remove/replace, what new harder steps to add, what new resources to include
4. Show a clear before/after of what will change
5. When user approves, start response with EXACTLY "EDIT_APPROVED:<goal_id>" (use the actual ID from the list above)

PROACTIVE COACHING — always watch for signals like:
- "too easy / too basic / I already know this" → offer to accelerate or increase difficulty
- "too hard / overwhelmed / struggling" → offer to break steps down more, slow the pace, add more beginner resources
- "I don't have time" → offer to extend timeline or reduce weekly commitments
- "I finished early / ahead of schedule" → offer to add advanced content or a new related goal
- "I need more resources / examples" → add specific links, books, videos to the relevant steps

Always be specific, warm, encouraging, and treat the plan as a living document that evolves with the user.`;
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