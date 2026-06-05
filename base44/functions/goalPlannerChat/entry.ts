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
    const { messages, mode, goal_id, existing_goals } = body;

    // ── EXTRACT PLAN: parse conversation into structured JSON ──────────────────

    const conversationText = messages.map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');
    const today = new Date().toISOString().split('T')[0];

    // Pre-scan the conversation to detect the timeline so we can enforce it in the extraction prompt
  // Detect timeline from any natural language (months, deadlines, dates)
  const _mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const _wNum = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
  const _now = new Date();
  let detectedMonths = null;
  const _em = conversationText.match(/(\d+)[- ]month/i);
  if (_em) detectedMonths = parseInt(_em[1], 10);
  if (!detectedMonths) { const m = conversationText.match(/in\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+years?/i); if (m) detectedMonths = (parseInt(m[1])||_wNum[m[1].toLowerCase()]||1)*12; }
  if (!detectedMonths) { const m = conversationText.match(/in\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+months?/i); if (m) detectedMonths = parseInt(m[1])||_wNum[m[1].toLowerCase()]||1; }
  if (!detectedMonths) { const m = conversationText.match(/in\s+(\d+)\s+weeks?/i); if (m) detectedMonths = Math.max(1, Math.round(parseInt(m[1])/4)); }
  if (!detectedMonths) { const m = conversationText.match(/by\s+(?:next\s+|this\s+|end\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)/i); if (m) { const ti=_mNames.indexOf(m[1].toLowerCase()); const isNext=/next/i.test(m[0]); let ty=_now.getFullYear(); if(ti<=_now.getMonth()||isNext)ty++; detectedMonths=Math.max(1,(ty-_now.getFullYear())*12+(ti-_now.getMonth())); } }
  if (!detectedMonths) { const m = conversationText.match(/(?:by|before)\s+(?:(?:the\s+)?end\s+of\s+)?(\d{4})/i); if (m) { const ty=parseInt(m[1]); if(ty>=_now.getFullYear()) detectedMonths=Math.max(1,(ty-_now.getFullYear())*12+(11-_now.getMonth())); } }
  if (!detectedMonths && /(?:by|before)\s+(?:the\s+)?end\s+of\s+(?:(?:this|the)\s+)?year/i.test(conversationText)) detectedMonths = Math.max(1, 11-_now.getMonth());
  if (!detectedMonths && /next\s+year/i.test(conversationText)) detectedMonths = Math.max(6, 12-_now.getMonth()+6);
    const monthsHint = detectedMonths
      ? `CRITICAL: The plan discussed in this conversation spans ${detectedMonths} months. You MUST generate steps for ALL ${detectedMonths} months (Month 1 through Month ${detectedMonths}). Do NOT stop at Month 2 or any earlier month. Each month MUST contain exactly 4 weeks. Total phases required: ${detectedMonths * 4}.`
      : `CRITICAL: Identify the full timeline from the conversation and generate steps for every single month/week discussed.`;

  const monthsRule = detectedMonths
  ? `- Use EXACTLY ${detectedMonths} months for this plan. Do NOT recalculate or shorten it. MANDATORY WEEKS: Each of the ${detectedMonths} months MUST have exactly 4 weeks (Week 1, Week 2, Week 3, Week 4). Total required week-phases: ${detectedMonths * 4}. Never combine or skip weeks.`
  : `- Identify the exact duration from the conversation (a deadline, date, or duration phrase). Use that many months — do NOT shorten it.`;

    if (mode === 'extract_plan') {
      // The plan text already exists in the conversation — just reformat it into JSON.
      // Use gpt-4o-mini (fast) since we're only restructuring already-written content.
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      const planText = lastAssistantMessage?.content || conversationText;

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You convert an already-written goal plan (in markdown) into structured JSON. The plan is complete — do NOT add, remove, or change any content. Just reformat it. Return ONLY valid JSON, no markdown fences.

Rules:
- Each step = one week. phase = "Month X, Week Y". title = "Week N: [focus from plan]".
- is_daily_habit: true for reading/fitness/language/music/meditation goals; false for milestone/project goals.
- requires_daily_action: same logic as is_daily_habit.
- notification_frequency: infer from goal type ("daily" for reading/fitness/language, "weekly" for career/finance/project).
- month_titles: extract the descriptive title after each "Month N —" heading.
- notification_schedule: generate 2-3 simple check-in notifications for Week 1 only (dates starting from today ${today}).
- due_dates: CRITICAL — MUST be calculated based on the step's phase (Month X, Week Y). Parse each step's phase, then calculate: due_date = start_date + (MonthNum-1)*30 + (WeekNum-1)*7 days. Use "target_date" from plan_summary to determine end date, then work backwards to find start date. Spread dates evenly across all steps from start to target end.
- weekdays_only: false unless goal is explicitly work/career focused.
- TIME PREFERENCE MAPPING (CRITICAL): Map natural language time preferences to actual times:
  * "morning" or "early" → 06:00 or 07:00
  * "afternoon" or "midday" → 12:00 or 14:00
  * "evening" or "late afternoon" → 18:00 or 19:00
  * "night" or "late evening" → 20:00 or 21:00
  * If user mentioned a specific time (e.g. "6pm", "7:30am"), use that exact time.
  * CRITICAL: Do NOT use times like "01:00 PM" for "evening" — that is wrong. Evening is 6-8 PM.`
          },
          {
            role: "user",
            content: `Convert this plan to JSON. CRITICAL: For due_dates, parse the phase (e.g. "Month 3, Week 2"), then calculate the actual date based on the plan's target_date and timeline. Do NOT use today's date for all steps. Spread dates across the entire timeline.\n\nPlan:\n\n${planText}\n\nReturn this exact structure:\n{\n  "title": "...",\n  "description": "...",\n  "timeline": "X months",\n  "target_date": "YYYY-MM-DD",\n  "category": "learning|health|career|finance|relationships|personal|creative|other",\n  "plan_summary": "...",\n  "notification_frequency": "daily|weekly|weekdays|3x_per_week|2x_per_week",\n  "requires_daily_action": true|false,\n  "weekdays_only": false,\n  "habit_days_of_week": [],\n  "month_titles": { "1": "title", "2": "title" },\n  "notification_schedule": [{ "id": "week_1_begin", "type": "week_summary_begin", "phase": "Month 1, Week 1", "scheduled_date": "YYYY-MM-DD", "scheduled_time": "09:00", "teaser_text": "...", "full_message_text": "..." }],\n  "steps": [{ "title": "Week N: focus", "description": "...", "phase": "Month X, Week Y", "priority": "medium", "due_date": "YYYY-MM-DD", "order_index": 0, "step_resources": [], "success_criteria": [], "tips_and_guidance": "", "is_daily_habit": false }]\n}`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);

      plan.steps = (plan.steps || []).map(step => ({
        ...step,
        step_resources: step.step_resources || [],
        success_criteria: step.success_criteria || [],
        tips_and_guidance: step.tips_and_guidance || ""
      }));
      plan.month_titles = plan.month_titles || {};
      plan.notification_schedule = plan.notification_schedule || [];
      plan.habit_days_of_week = plan.habit_days_of_week || [];

      // Calculate due dates based on phase (Month X, Week Y), target_date, and timeline
      const todayDate = new Date(today);
      const targetDate = plan.target_date ? new Date(plan.target_date + 'T23:59:59Z') : null;
      
      if (plan.steps.length > 0 && targetDate) {
        // Parse timeline to get total months
        const timelineMatch = plan.timeline?.match(/(\d+)/);
        const totalMonths = timelineMatch ? parseInt(timelineMatch[1], 10) : 12;
        
        // Calculate start date: target_date - totalMonths
        const startDate = new Date(targetDate);
        startDate.setUTCMonth(startDate.getUTCMonth() - totalMonths);
        
        console.log(`[goalPlannerChat extract_plan] Calculating due_dates: timeline=${plan.timeline}, totalMonths=${totalMonths}, startDate=${startDate.toISOString().split('T')[0]}, targetDate=${targetDate.toISOString().split('T')[0]}`);
        
        // For each step, extract its phase and calculate due_date
        for (const step of plan.steps) {
          if (step.due_date && new Date(step.due_date) > todayDate) {
            // AI provided a valid future date, keep it
            continue;
          }
          
          // Parse phase to extract Month and Week numbers
          const phaseMatch = step.phase?.match(/Month\s+(\d+)(?:[,\s]+Week\s+(\d+))?/i);
          if (phaseMatch) {
            const monthNum = parseInt(phaseMatch[1], 10);
            const weekNum = phaseMatch[2] ? parseInt(phaseMatch[2], 10) : 1;
            
            // Calculate days from start: (monthNum-1)*30 + (weekNum-1)*7
            const daysFromStart = (monthNum - 1) * 30 + (weekNum - 1) * 7;
            const stepDueDate = new Date(startDate);
            stepDueDate.setUTCDate(stepDueDate.getUTCDate() + daysFromStart);
            
            step.due_date = stepDueDate.toISOString().split('T')[0];
            console.log(`[goalPlannerChat extract_plan] Step phase="${step.phase}" → due_date=${step.due_date}`);
          } else {
            // Fallback: spread linearly from start to target
            const daysAvailable = (targetDate - startDate) / (1000 * 60 * 60 * 24);
            const stepIndex = plan.steps.indexOf(step);
            const daysPerStep = daysAvailable / plan.steps.length;
            const stepDueDate = new Date(startDate);
            stepDueDate.setUTCDate(stepDueDate.getUTCDate() + Math.round((stepIndex + 1) * daysPerStep));
            step.due_date = stepDueDate.toISOString().split('T')[0];
          }
        }
      }

      console.log(`[goalPlannerChat] extract_plan done: ${plan.steps.length} steps, ${plan.timeline}`);
      return Response.json({ plan, month_titles: plan.month_titles, notification_schedule: plan.notification_schedule, requires_daily_action: plan.requires_daily_action, weekdays_only: plan.weekdays_only, include_weekend_reminders: plan.include_weekend_reminders, habit_days_of_week: plan.habit_days_of_week });
    }

    // ── APPLY EDIT: commit approved edits to an existing goal ─────────────────
    if (mode === 'apply_edit') {

      // Fetch existing goal & steps
      const existingGoal = await base44.entities.Goal.list().then(all => all.find(g => g.id === goal_id));
      const existingSteps = await base44.entities.GoalStep.filter({ goal_id });

      // Separate completed steps (keep) from pending/in_progress (will be replaced)
      const completedSteps = existingSteps.filter(s => s.status === 'completed');
      const replaceableSteps = existingSteps.filter(s => s.status !== 'completed');

      // Extract the new plan from the conversation using AI
      const extractionResponse = await openai.chat.completions.create({
         model: "gpt-4o-mini",
         messages: [
           {
             role: "system",
             content: `You extract the new goal plan proposed in a conversation. Return ONLY valid JSON, no markdown.
      CRITICAL RULES:
      1. Extract EVERY step the planner proposed in their latest plan. Do NOT omit any steps.
      2. ENFORCE WEEK ORDERING: For each month, steps MUST appear in order: Week 1, Week 2, Week 3, Week 4 (not scrambled or out of order).
      3. FOR READING GOALS: If the planner mentioned looking up chapter counts or specific chapter ranges (e.g. "Ch 1-15", "chapters 1-12"), you MUST include those exact chapter ranges in the step titles and descriptions. Do NOT use vague percentages like "~50%" when a chapter count is available. Use the actual chapter numbers.
      4. The output is used to completely replace all existing steps, so you must be exhaustive and complete.
      5. NOTIFICATION FREQUENCY DETECTION: Analyze the conversation for clues about how often the user wants to be reminded — infer from context:
      - Daily tasks / practice / reading → "daily"
      - Weekday focus only → "weekdays"
      - Once per week → "weekly"
      - Multiple times per week → "3x_per_week" or "2x_per_week"
      Set "notification_frequency" in the returned JSON to one of: "daily", "weekdays", "weekly", "3x_per_week", "2x_per_week"
      6. MONTH TITLES (if changed): Include "month_titles" in goal_updates with real, specific titles (not placeholders).`
          },
          {
            role: "user",
            content: `Goal: "${existingGoal?.title || 'Unknown'}"

Conversation:
${conversationText}

Extract ALL steps from the planner's most recent proposed plan/changes. Include goal-level updates if the title, timeline, or description changed.

Return JSON:
{
  "goal_updates": {
    "title": "only if changed",
    "description": "only if changed",
    "plan_summary": "only if changed",
    "timeline": "only if changed",
    "target_date": "YYYY-MM-DD only if changed",
    "month_titles": { "1": "title", "2": "title" }
  },
  "new_steps": [
    { "title": "...", "description": "...", "phase": "Month X, Week Y", "priority": "low|medium|high|critical", "due_date": "YYYY-MM-DD", "order_index": 0, "step_resources": [], "success_criteria": [], "tips_and_guidance": "", "is_daily_habit": false }
  ]
}
today = ${today}
Extract every single step. If the planner listed 48 steps, return all 48.`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const extracted = JSON.parse(extractionResponse.choices[0].message.content);

      // Apply goal-level updates
      const goalUpdates = extracted.goal_updates || {};
      if (Object.keys(goalUpdates).length > 0) {
        const { month_titles, ...otherUpdates } = goalUpdates;
        if (Object.keys(otherUpdates).length > 0) {
          await base44.entities.Goal.update(goal_id, otherUpdates);
        }
        // Fully replace month_titles with the new ones from the revised plan
        if (month_titles && Object.keys(month_titles).length > 0) {
          await base44.entities.Goal.update(goal_id, { month_titles });
        }
      }

      // Delete ALL replaceable (non-completed) steps
      for (const step of replaceableSteps) {
        await base44.entities.GoalStep.delete(step.id);
      }

      // Create all new steps from the proposed plan
      // ENFORCE WEEK ORDERING: Sort steps so weeks appear in correct sequence within each month
      const newSteps = extracted.new_steps || [];
      newSteps.sort((a, b) => {
        const aMonth = parseInt(a.phase?.match(/Month (\d+)/i)?.[1] || 0);
        const bMonth = parseInt(b.phase?.match(/Month (\d+)/i)?.[1] || 0);
        if (aMonth !== bMonth) return aMonth - bMonth;
        const aWeek = parseInt(a.phase?.match(/Week (\d+)/i)?.[1] || 0);
        const bWeek = parseInt(b.phase?.match(/Week (\d+)/i)?.[1] || 0);
        return aWeek - bWeek;
      });

      for (let i = 0; i < newSteps.length; i++) {
        const step = newSteps[i];
        await base44.entities.GoalStep.create({
          goal_id,
          title: step.title,
          description: step.description || "",
          phase: step.phase || "",
          priority: step.priority || "medium",
          due_date: step.due_date || "",
          order_index: step.order_index ?? i,
          status: "pending",
          step_resources: step.step_resources || [],
          success_criteria: step.success_criteria || [],
          tips_and_guidance: step.tips_and_guidance || "",
          is_daily_habit: step.is_daily_habit === true
        });
      }

      return Response.json({ success: true, steps_replaced: replaceableSteps.length, steps_created: newSteps.length, completed_kept: completedSteps.length });
    }

    // ── CHAT: main conversational mode ────────────────────────────────────────
    // Load user's existing goals — use user-scoped client so RLS returns their own goals
    let existingGoalsList = [];
    try {
      existingGoalsList = await base44.entities.Goal.list('-created_date', 50);
    } catch (_) { /* ignore */ }

    // Load steps for all goals so AI has full context even in new-plan mode
    let allStepsMap = {};
    try {
      for (const g of existingGoalsList) {
        const steps = await base44.entities.GoalStep.filter({ goal_id: g.id });
        allStepsMap[g.id] = steps.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      }
    } catch (_) { /* ignore */ }

    const goalsSummary = existingGoalsList.length > 0
      ? `The user has these existing goals (with their full step lists):\n${existingGoalsList.map(g => {
          const steps = allStepsMap[g.id] || [];
          const phaseMap = {};
          steps.forEach(s => {
            const p = s.phase || 'Uncategorized';
            if (!phaseMap[p]) phaseMap[p] = [];
            phaseMap[p].push(s.title);
          });
          const phaseSummary = Object.entries(phaseMap)
            .map(([phase, titles]) => `      ${phase}: ${titles.join(', ')}`)
            .join('\n');
          return `- ID: ${g.id} | Title: "${g.title}" | Status: ${g.status} | Timeline: ${g.timeline || 'N/A'}\n${phaseSummary || '      (no steps)'}`;
        }).join('\n\n')}`
      : 'The user has no existing goals yet.';

    const isEditSession = !!goal_id;


    let systemPrompt;
    if (isEditSession) {
      // Fetch current goal + steps for context
      const currentGoal = existingGoalsList.find(g => g.id === goal_id);
      const currentSteps = await base44.entities.GoalStep.filter({ goal_id });
      const stepsText = currentSteps
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        .map(s => `  [${s.phase || 'No phase'}] ${s.title} (${s.priority}, due: ${s.due_date || 'TBD'}, status: ${s.status})`)
        .join('\n');

      // Group steps by phase so the AI can see gaps clearly
      const phaseMap = {};
      currentSteps.forEach(s => {
        const p = s.phase || 'Uncategorized';
        if (!phaseMap[p]) phaseMap[p] = [];
        phaseMap[p].push(s.title);
      });
      const phasesSummary = Object.entries(phaseMap)
        .map(([phase, titles]) => `  ${phase} (${titles.length} steps):\n${titles.map(t => `    - ${t}`).join('\n')}`)
        .join('\n');

      // Extract original conversation context (what user said during planning)
      const originalConversation = currentGoal?.conversation_history || [];
      const originalContextText = originalConversation.length > 0
        ? `\nORIGINAL PLANNING CONVERSATION (user's stated constraints, time availability, preferences):\n${originalConversation.slice(0, 10).map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n')}`
        : '';

      // Calculate how many months the plan should span
      const parseMonthsFromTimeline = (timeline) => {
        const match = timeline?.match(/(\d+)\s*month/i);
        return match ? parseInt(match[1], 10) : null;
      };
      const targetMonths = parseMonthsFromTimeline(currentGoal?.timeline);
      const monthsFromCreation = currentGoal?.created_date
        ? Math.round((new Date(today) - new Date(currentGoal.created_date)) / (1000 * 60 * 60 * 24 * 30.44))
        : null;

      systemPrompt = `You are an expert goal planner and ongoing accountability partner helping a user EDIT and EVOLVE an existing goal.

TODAY'S DATE: ${today}. Use this to calculate timelines accurately.

CURRENT GOAL: "${currentGoal?.title || 'Unknown'}"
DESCRIPTION: ${currentGoal?.description || 'N/A'}
PLAN SUMMARY: ${currentGoal?.plan_summary || 'N/A'}
TIMELINE: ${currentGoal?.timeline || 'N/A'} (Target Date: ${currentGoal?.target_date || 'N/A'})
GOAL CREATED: ${currentGoal?.created_date ? new Date(currentGoal.created_date).toISOString().split('T')[0] : 'N/A'}
${monthsFromCreation !== null ? `MONTHS ELAPSED SINCE CREATION: ~${monthsFromCreation}` : ''}
${targetMonths !== null ? `PLAN SHOULD SPAN ${targetMonths} MONTHS TOTAL (Month 1 through Month ${targetMonths})` : ''}
${originalContextText}

FULL PLAN — ALL EXISTING STEPS BY PHASE:
${phasesSummary || '  (no steps yet)'}

CRITICAL TIMELINE CHECK:
If the current plan shows Month 1-5 but should span 12 months, that is a MAJOR GAP. When user says "fill in the rest", you MUST generate Month 6 through Month 12 in full detail. Do NOT leave months empty. Do NOT ask questions. Generate the complete missing phases immediately.

ABSOLUTE RULES — VIOLATIONS ARE NOT ACCEPTABLE:

RULE 1 — DEFAULT TO ACTION, NOT QUESTIONS: For virtually every request, you already have everything you need: the full step list, original conversation, description, timeline, time commitment, and creation date. Your default response to ANY edit request is a concrete proposal — not questions.

RULE 2 — THE ONLY TIME YOU MAY ASK A QUESTION:
   It is genuinely unclear WHICH goal the user is referring to (only possible if they have 2+ goals and haven't specified).
   That's it. No other questions are ever allowed. Not "do these resonate?", not "what resources do you prefer?", not "what type of support do you want?" — nothing. Commit to a full, specific proposal and end with "Want me to add this to your plan?" or "Say 'yes' to save this."

RULE 3 — GAP-FILLING IS ALWAYS IMMEDIATE AND REQUIRES ZERO QUESTIONS: When the user asks to add a missing week or phase, you MUST respond with a fully-formed list of 5-8 specific steps RIGHT NOW. You have the full plan above — look at what comes before and after the gap and infer the logical progression. This is NON-NEGOTIABLE. There is NO scenario where asking a question is acceptable here. Your response MUST look like:

"Here's Week 2 of Month 3 for your [goal name]:
1. [Specific step title] — [description]
2. [Specific step title] — [description]
...
Say 'yes' to add these to your plan."

That's it. No "here are a couple of questions first", no "to tailor this to your needs", no "is there a particular area you'd like to focus on". Just the steps.

RULE 4 — TIMELINE ACCURACY: The goal was created on ${currentGoal?.created_date ? new Date(currentGoal.created_date).toISOString().split('T')[0] : 'recently'}. Today is ${today}. Use these to know where the user is. Do NOT assume they are in a specific month unless you can calculate it.

RULE 5 — APPROVAL TRIGGER: When user says "yes", "looks good", "do it", "apply it", "perfect", "save it", "go ahead", "ok", "sure" — start response with EXACTLY "EDIT_APPROVED" then summarize what changed.

TIMELINE EXTENSION — CRITICAL RULES:
When a user requests to extend the plan (e.g., "add 2 more months", "extend by 3 months", "I need more time", "give me longer"), NEVER just append months to the end. The original plan was designed to conclude at its current end date.

INSTEAD, you must offer and recommend ONE of these two options based on context:

OPTION A — FULL RESTRUCTURE (Recommended when: user is behind on schedule, hasn't started later phases, or is struggling to keep pace):
- Recalculate the ENTIRE plan from scratch using the new total duration.
- Redistribute the same goals and milestones across the longer timeline.
- The final month of the restructured plan becomes the new completion point.
- Delete all existing incomplete steps and replace with the new structured plan.
- Message to user: "I'm restructuring your full plan to span [new total] months. This spreads everything out so you have more breathing room and everything flows naturally to the new end date."

OPTION B — EXTEND WITH NEW ADVANCED CONTENT (ONLY if user explicitly wants MORE content, not just more time):
- Only use this if the user says something like "I want to go deeper", "add advanced phases", "I want more material", "extend and add new things".
- Add entirely new phases BEYOND the original completion point (e.g., adding Months 7-9 when the original plan ended at Month 6).
- The new content should be genuinely advanced or exploratory, not just padding.
- Message to user: "I've added [X] months of advanced content after your original completion point to build deeper expertise."

DEFAULT: When in doubt, recommend OPTION A. It's almost always the right choice.

When presenting the extension choice to the user, offer both options clearly so they understand the difference, but recommend the one you think best fits their situation. Format like:
"I can help extend your timeline. Here are your options:
**Option A: Restructure** (my recommendation) — I'll spread the whole plan across [new duration], giving you more time per phase...
**Option B: Extend & Add** — I'll add [X] new months of advanced content beyond where your plan currently ends...
Which would you prefer?"

Wait for their choice before generating the actual extended plan.

TIMELINE EXTENSION — CRITICAL RULE:
When a user asks to extend the timeline (e.g. "add 2 more months", "extend by 3 months", "give me more time"), you MUST NOT simply append new months at the end of the existing plan. The original plan was designed to conclude at its final month — appending would create two different endpoints and a disjointed plan.

Instead, you MUST do ONE of the following (choose based on context):

OPTION A — FULL RESTRUCTURE (preferred when user is behind or hasn't started later phases):
Recalculate the ENTIRE plan from scratch with the new total duration. Spread the same goals/milestones across the new longer timeline. The final month of the new plan becomes the new completion point. Delete all existing incomplete steps and replace with the restructured plan. Clearly tell the user: "I'm restructuring your full plan to span [new total] months so everything flows naturally to the end."

OPTION B — EXTEND BY ADDING GENUINE NEW CONTENT (only when user is ahead and wants MORE depth):
Only valid if the user explicitly says they want MORE content or a deeper dive, NOT just more time. In this case, add new phases that build BEYOND where the original plan ended — don't just pad the existing phases. Tell the user: "I've added [X] months of advanced content after your original endpoint."

DEFAULT: If in doubt, use OPTION A. Never silently append months without acknowledging that the structure was adjusted.

PROACTIVE COACHING — watch for these signals and respond accordingly:
- "too easy / too basic / I already know this" → propose accelerating phases, removing beginner steps, adding harder content
- "too hard / struggling / overwhelmed" → propose breaking steps into smaller pieces, slowing pace, adding foundational resources
- "I don't have time" → propose extending timeline or reducing weekly step count (OPTION A restructure)
- "I finished early" → propose adding advanced phases or a follow-on goal (OPTION B new content)
- "I need more resources" → add specific links, videos, books to relevant steps
- "a week/phase got skipped / is missing" → look at surrounding weeks/phases in the plan above and fill the gap logically

TIME PREFERENCE MAPPING (CRITICAL):
When extracting preferred_time or habit_time from the conversation:
- "morning" or "early" → 06:00 or 07:00
- "afternoon" or "midday" → 12:00 or 14:00
- "evening" or "late afternoon" → 18:00 or 19:00
- "night" or "late evening" → 20:00 or 21:00
- If user mentioned a specific time (e.g. "6pm", "7:30am"), use that exact time
- CRITICAL: Do NOT use times like "01:00 PM" for "evening" — evening is 6-8 PM, not 1 PM

READING/BOOK GOALS — CRITICAL: NEVER guess or invent chapter/page counts. You MUST use web_search to look up the exact number of chapters in each specific book before dividing into weekly reading chunks. Divide evenly: total chapters ÷ 4 = chapters per week (balanced across all 4 weeks).

██████████████████████████████████████████████████████████
ABSOLUTE RULE — NO FABRICATION OF ANY FACTS
██████████████████████████████████████████████████████████
You MUST use web_search before stating ANY specific fact you are not 100% certain of. This includes:
- Health/fitness: which exercises are effective for a specific outcome, injury risks, muscle groups targeted, calorie burns, recovery times
- Plants/gardening: which plants thrive in a specific climate, hardiness zones, sun/water requirements, seasonal timing
- Nutrition: specific macro counts, health claims, food interactions, dietary recommendations
- Finance: interest rates, investment returns, fees, tax rules, pricing
- Science/medicine: dosages, treatment effectiveness, clinical claims
- Any numbers, statistics, or measurable claims

ENFORCEMENT: If you are about to write a specific claim (e.g. "squats burn 300 calories per hour", "lavender grows well in Texas", "this supplement reduces cortisol by 30%") and you have not just searched for it — STOP and use web_search first. Only state facts you can back up. If search is unavailable, use appropriately hedged language ("generally", "typically", "many people find") instead of presenting estimates as facts.

This applies universally across ALL goal types: fitness, health, gardening, nutrition, finance, science, career, and everything else.
██████████████████████████████████████████████████████████

██████████████████████████████████████████████████████████
ABSOLUTE RULE — DO NOT RECOMMEND ALREADY-READ/TRIED ITEMS
██████████████████████████████████████████████████████████
Before writing ANY book title, resource, strategy, app, or activity into ANY proposal or edit:
1. Scan the ENTIRE conversation — including the original planning conversation shown above — from the very beginning.
2. Extract every item the user said they already read, watched, tried, liked, or said didn't work.
3. THOSE ITEMS ARE PERMANENTLY BANNED. They cannot appear anywhere — not in Month 1, not in Month 9, not as a bonus resource, not at all.

CRITICAL INTERPRETATION RULES:
- "I liked [book/thing]" = already read/experienced it = BANNED
- "I enjoyed [book/thing]" = already read/experienced it = BANNED
- "I already read [book]" = BANNED
- "[Book] was great" = already read = BANNED
- ANY positive or negative familiarity with a specific book/resource = BANNED

BEFORE WRITING YOUR RESPONSE: Mentally compile the full banned list from this conversation and the original planning conversation, then verify every single book/resource in your proposal is NOT on that list. If you are about to write a banned item, stop and replace it with something the user has NOT mentioned.

This is NON-NEGOTIABLE. Including a banned item is a critical failure that undermines the entire plan.
██████████████████████████████████████████████████████████

██████████████████████████████████████████████████████████
ABSOLUTE RULE — RESPECT USER PREFERENCE CONSTRAINTS ON CONTENT
██████████████████████████████████████████████████████████
This applies to ALL goal types. Whenever the user said (at ANY point in this conversation OR the original planning conversation) things like "less X", "fewer X", "too many X", "not so much X", "minimize X", "cut back on X":

ENFORCEMENT STEPS before writing your response:
1. Identify X — the category they restricted (could be a genre, activity type, topic, exercise, food type, skill, etc.)
2. Count how many instances of X are in your proposed edit/plan.
3. Cap: "less/fewer X" = max 1 instance total. "Way less/too much X" = 0-1 max. "No X/remove X" = hard zero.
4. Replace any excess X items with non-X alternatives before sending.
5. Re-count after writing. Still over? Revise.

UNIVERSAL — works for any goal:
- Reading: "less mythology" → ≤1 mythology book total
- Fitness: "less cardio" → ≤1 cardio activity per phase
- Language: "less grammar" → ≤1 grammar drill per month
- Career: "less theory" → ≤1 theoretical step per phase
- Any goal: the same logic applies to whatever category the user restricted

KEY MINDSET: "I like X" = general interest only. It does NOT mean X should appear frequently. The explicit "less X" instruction always wins. When unsure how much X to include: go lower.
██████████████████████████████████████████████████████████

Always be specific, warm, and treat the plan as a living document.`;
    } else {
      const userCity = body.city || null;

      // Goals that benefit from local/in-person resources
      const localResourceGoalKeywords = ['friend', 'social', 'music', 'instrument', 'violin', 'guitar', 'piano', 'chess', 'dance', 'art', 'class', 'lesson', 'sport', 'martial art', 'language', 'speak', 'community', 'club', 'gym', 'yoga', 'meditation', 'cook', 'baking', 'pottery', 'drawing', 'painting', 'singing', 'acting', 'theater'];

      systemPrompt = `You are an expert goal planner, life coach, and ongoing accountability partner. Your job is to help users create brand-new detailed, actionable, realistic goal plans — AND continuously refine, adjust, and improve them over time.

TODAY'S DATE: ${today}. CRITICAL: Always use this to calculate timelines accurately. When a user mentions a target date like "by December 2026", calculate the exact number of months from today to that date. Do NOT guess or use a generic number — compute it precisely (e.g. May 2026 → December 2026 = 7 months).

${goalsSummary}
${userCity ? `USER'S CITY: ${userCity}` : ''}

WHEN CREATING A NEW GOAL — FOLLOW THIS EXACT SEQUENCE:

PHASE 0 — DETECT WHEN TO SKIP INFO GATHERING:
If the user's CURRENT message (not the history) contains ALL the key details needed for planning, SKIP to Phase 2 immediately. This happens when they provide:
- Specific goal description + target timeline/duration
- Time commitment or schedule preferences
- Budget or resource constraints (if applicable)
- Any other critical constraints they already stated

CRITICAL EXCEPTION — READING/BOOK GOALS: A message like "read 12 books in 12 months" or "read more books this year" does NOT qualify for Phase 0 skip, even if a timeline is provided. You MUST ask Phase 1 questions first to determine: which genres/authors they enjoy, books they've already read (so you don't repeat them), and their budget for books. NEVER generate a reading plan without knowing their preferences. Generic genre labels (Contemporary Fiction, Science Fiction, etc.) are NOT acceptable substitutes for real personalized book selections — you must know what the user actually likes.

For all other goals: if the message contains enough detail, generate the COMPLETE plan immediately with NO questions. Do NOT ask "are you ready for me to build the plan?" — just build it.

PHASE 1 — GATHER INFO FIRST (STRICTLY REQUIRED before drafting any plan IF Phase 0 does not apply):
1. On the FIRST response, ask ALL the questions you need in one numbered list. Do NOT split them across multiple messages. Ask everything at once. CRITICAL RULES FOR QUESTIONS:
   a) NEVER ask two questions that cover the same topic (e.g. "experience level" and "prior attempts" are the same — merge them into ONE question like "What's your current experience with this, including any past attempts that worked or didn't?")
   b) Every question must have a direct, clear purpose in shaping the plan — if you ask about fears/obstacles, TELL the user how you'll use that answer (e.g. "What obstacles or fears do you have? I'll build specific contingency steps into your plan to address them.")
   c) FOR PURCHASE/SAVINGS GOALS (buying a car, saving for a product, down payment, etc.): Before asking price questions, use your knowledge or web search to look up the likely MSRP or price range of the specific item mentioned. Then reference it directly in the question, e.g. "The 2026 Toyota Camry has an MSRP of around $29,000. Are you looking to save the full purchase price, or are you planning to finance and just need a down payment? What's your target amount?" — do NOT ask a generic "how much do you need to save" question.
   d) The questions to ask are:
       - ONE combined experience + prior attempts question — ALWAYS ASK THIS, NO EXCEPTIONS: "What's your current experience with this? Have you tried before — and if so, what worked or didn't?" This is MANDATORY for every single goal type including reading goals. Never skip it.
        - What obstacles or fears do they have? — ALWAYS ASK THIS, NO EXCEPTIONS: "What obstacles or fears do you have about this goal? I'll build specific contingency steps into your plan to address them." This is MANDATORY for every single goal type. Never skip it.
        - The specific target amount / outcome question (for finance goals: reference the real price as above)
        - How much can they realistically commit per month (time or money)
        - Any specific deadline or target date? — ONLY ask this if the user has NOT already mentioned a deadline or timeframe in their goal description. If they said "by end of 2026", "before Christmas", "in 6 months", etc., skip this question entirely and use that date.
        - CRITICAL NEW: When do you want to START this goal? (e.g. "immediately", "next month", "after my vacation", a specific date). I'll calculate the exact timeline from your start date to the end date, so your plan aligns with when you're actually ready to begin.
        - FOR HEALTH/FITNESS GOALS ONLY: What time of day do they prefer to work out/exercise?
         - FOR DAILY ACTION GOALS ONLY (practice, reading, exercise, learning): "Do you want reminders on weekends too, or just weekdays?" This determines if your daily notifications run 7 days a week or Mon-Fri only.
         - BUDGET QUESTION (ask for virtually ALL goals — books, courses, activities, tools, coaching, classes, experiences all cost money): Ask "Do you have a budget for things like books, courses, activities, or tools? Even a rough idea helps — or I can stick to free resources only." The ONLY exception: skip this question if the goal is purely about saving or paying off money (e.g. "save $5000", "pay off credit card debt") where spending on resources makes no sense. Use the answer to STRICTLY filter all resource recommendations:
         * If they say NO budget / free only → ONLY recommend free resources (YouTube, free apps, free articles via Google search, free PDFs). NEVER recommend paid books, paid courses, or paid tools.
         * If they give a budget → tailor recommendations to fit within it (e.g. one $15 book per month if budget is $15/month). Prioritize highest-value paid resources first.
         * If they don't answer or are vague → default to free resources only.
         * CRITICAL: If you never asked the budget question at all (because it wasn't relevant), you MUST treat it as "free only" — NEVER recommend paid books, paid courses, or paid tools in that case. The absence of a budget question = free only.
2. CRITICAL RULE — DO NOT DRAFT A PLAN UNTIL YOU HAVE RECEIVED ANSWERS TO YOUR QUESTIONS. You MUST have at least 2 back-and-forth exchanges (the user must have replied at least TWICE with substantive answers) before presenting any plan. If the user has only replied once, you MUST ask follow-up questions on anything vague or unanswered. Never skip straight to a plan after a single user reply.
3. CRITICAL — LOCAL RESOURCES: If the goal could benefit from in-person/local services (music lessons, chess clubs, dance, martial arts, language exchange, art classes, etc.):
   - If you already know the user's city (${userCity ? `it is ${userCity}` : 'you do NOT know it yet'}), ask if they want local resources included.
   - If you do NOT know the user's city, ask them: "What city are you in? (optional — I can include local classes, clubs, and meetups near you if you share it)"
   - Only ask ONCE and only for goals where in-person options genuinely add value.

PHASE 2 — DRAFT THE FULL PLAN (only after sufficient info gathered):
CRITICAL TRANSITION RULE: When the user has replied at least TWICE with substantive answers to your Phase 1 questions, you MUST assume that's enough info and immediately draft the COMPLETE plan in your response. DO NOT say "I'll draft the plan next" or "stay tuned" or any deferral language. 

RESPONSE STRUCTURE (MANDATORY):
1. 2-3 sentence summary of what you heard (preferences, constraints, timeline, goals)
2. IMMEDIATELY BELOW: The full month-by-month markdown plan (ALL months, no abbreviations)
3. THEN: Ask for approval

All of this appears in ONE response. Never separate the summary from the plan with deferral language.

${monthsRule}

MANDATORY MARKDOWN FORMAT — use this exact structure for however many months the user's timeline requires (3-month plan = 3 months, 7-month plan = 7 months — NEVER add or remove months from what the timeline dictates):

**Month 1 — [Descriptive Title]**
**Week 1**
- [specific task]
- [specific task]

**Week 2**
- [specific task]
- [specific task]

**Week 3**
- [specific task]
- [specific task]

**Week 4**
- [specific task]
- [specific task]

**Month 2 — [Descriptive Title]**
**Week 1**
- [specific task]
- [specific task]

(Continue this exact pattern for EVERY SINGLE MONTH. Generate ALL months inline in this response. Do NOT say "I'll continue constructing" or "subsequent months will follow" — generate them now. Every month must be complete with all 4 weeks. This is a single response, not a placeholder.)

CRITICAL FORMAT RULES:
- Every month MUST start with "**Month N — Title**" on its own line
- Every week MUST start with "**Week N**" on its own line directly under its month
- Tasks MUST be "- task" bullet points under each week
- NEVER skip this structure for ANY month. Month 6 must look identical in structure to Month 1.
- NEVER write a month without its 4 weeks immediately following it.
- ABSOLUTELY FORBIDDEN: Placeholder language like "(Repeat for every month...)" or "(I'll continue constructing...)" — these are CRITICAL FAILURES. Generate the complete markdown for all months NOW in this single response. Every single month must be fully written out.

4. STRICT PHASE NAMING RULES — VIOLATIONS ARE NOT ACCEPTABLE:
   - NEVER combine weeks: "Week 1-2", "Week 3-4", "Weeks 5-6" are ALL FORBIDDEN. Every week is its own entry: "Month 1, Week 1", "Month 1, Week 2", etc.
   - NEVER combine months: "Month 9-12", "Months 3-6", "Month 7-10", "Months 4-12" are ALL FORBIDDEN. Every month is its own entry: "Month 9", "Month 10", "Month 11", "Month 12".
   - NEVER write a summary placeholder for a range of months (e.g. "Month 9-12: I'll continue selecting books each month" or "Months 5-12: Other Selections" — these are CRITICAL FAILURES).
   - NEVER use ranges of any kind. Each phase = exactly ONE month OR one week.
   - EVERY month must have all 4 weeks. Never give Month 1 four weeks and then just "Month 2" with no weeks.

   GRANULARITY — choose the right level based on goal type:
   - DAILY PRACTICE GOALS (instrument, language, fitness, coding, drawing, martial arts): break each week into daily tasks (Monday–Sunday or Day 1–7). Mark as is_daily_habit: true.
   - MILESTONE/PROJECT GOALS (finance, career, business, travel, concrete measurable outcomes): 2-4 specific action steps per week — no daily breakdown needed.
   - SOFT/PERSONAL GROWTH GOALS (self-confidence, anxiety, boundaries, saying no, mindset, emotional wellbeing, relationships, happiness): 3-7 reflection prompts or practice goals per week — NO daily breakdown, NO rigid scheduling. Keep it gentle and flexible.
   - Rule of thumb: Does this skill require daily repetition to build? → daily. Is it about outcomes through periodic effort? → weekly milestones.
   - UNIVERSAL SPECIFICITY RULE — APPLIES TO ALL GOAL TYPES — CRITICAL FAILURE IF VIOLATED: Every plan step title and month_title MUST be specific, actionable, and grounded in what the user told you during the planning conversation — their preferences, experience level, equipment, schedule, and stated details. Generic filler content is a CRITICAL FAILURE. Examples of forbidden filler: "workout today", "practice today", "Week 3 training", "Month 4 task", "exercise session", "study session", "do your goal", or any vague placeholder that could apply to anyone. Instead — fitness goals: name actual exercises, sets, reps, progressions (e.g. "3x10 goblet squats + 20 min incline walk"). Language goals: name specific vocabulary sets, grammar topics, or lessons (e.g. "past tense conjugations — 30 irregular verbs"). Nutrition goals: name concrete strategies (e.g. "swap breakfast to Greek yogurt + berries, eliminate soda"). Skill-building goals: name real tasks, tools, or projects (e.g. "build a CSS flexbox layout from scratch"). Every plan must reflect the user's specific situation — NEVER generate content that could apply to any random person with the same goal type.
   - READING/BOOK GOALS: CRITICAL — NEVER guess or invent chapter/page counts for any specific book. You MUST use the web_search tool to look up the exact chapter count for every book before dividing it into weekly reading chunks. Divide evenly: total chapters ÷ 4 = chapters per week (round to balance all 4 weeks). If a book has no chapters, use total pages ÷ 4. You MUST also assign a specific, real book title to EVERY month in month_titles based on the user's genre/preferences — NEVER leave any month with a placeholder like "Book Title", "TBD", or a generic description.
5. Create a detailed phased plan with milestones (Month 1, Month 2, Week 1, etc.) that EXACTLY fits the user's stated timeline AND start date. CRITICAL LOGIC:
    - If user said "start immediately" or "start now" → calculate months from TODAY (${today}) to their target end date.
    - If user gave a future start date (e.g., "June 1st", "next month") → calculate months FROM THAT START DATE to their target end date, then name the phases accordingly ("Month 1" = first month after their start date, not today).
    - Example: User says "start June 1st, done by December 31st" → that's ~7 months. Your plan spans Month 1 (June 1 – June 30) through Month 7 (December). The timeline document should reflect "Starts June 1, 2026 | Ends December 31, 2026 | 7 months".
    - CRITICAL ENFORCEMENT: If the timeline spans 12 months, there MUST be 12 months of content (Month 1 through Month 12). If the user says "by end of year" and today is May, calculate the exact months remaining and FILL EVERY SINGLE MONTH/WEEK with relevant steps. No shortcuts, no stopping at 5 months when the timeline is longer. The plan must span the entire stated duration between start and end dates.
5. Include specific, actionable steps — not vague suggestions. NEVER present only 2-3 ideas and ask if they resonate. Always present the COMPLETE plan.
6. CRITICAL: For EVERY phase/week, include concrete resources:
   - Video tutorials with actual links (YouTube, Skillshare, Udemy, etc.)
   - Book recommendations (Amazon links or ISBN)
   - Apps, tools, or free resources
   - If user opted in to local resources: specific local venues, clubs, meetup groups, schools (search for real ones${userCity ? ` in ${userCity}` : ''})
7. CRITICAL: Any specific resources, links, books, apps, or tools mentioned during the conversation MUST be included in the relevant step's resources in the final plan — nothing gets lost.
7b. RESOURCE LINK RULES — CRITICAL — BROKEN LINKS ARE WORSE THAN NO LINKS:
   - NEVER guess or fabricate article/blog URLs. If you're thinking of linking to additudemag.com, psychologytoday.com, medium.com, or any site with a guessed path — DON'T. Use a Google search URL instead.
   - NEVER construct a URL by inventing a path (e.g. /blog/article-name, /tips/productivity). Only use paths you are 100% certain exist.
   - SAFE URL FORMATS — replace ALL CAPS with real specific values, NEVER leave placeholder text:
     * YouTube search: https://www.youtube.com/results?search_query=beginner+guitar+lesson (use the real topic)
     * Amazon book search: https://www.amazon.com/s?k=The+Happiness+Advantage+Shawn+Achor (use real title + author)
     * Google search fallback: https://www.google.com/search?q=CHADD+ADHD+support+Austin+TX (use specific real terms)
     * Udemy: https://www.udemy.com/courses/search/?q=guitar+for+beginners (real topic)
     * Coursera: https://www.coursera.org/search?query=machine+learning (real topic)
     * App root domain only (e.g. https://www.duolingo.com) — ONLY if 100% certain.
   - FORBIDDEN: Google Maps search links. Do NOT use https://www.google.com/maps/search/... — this is lazy and unhelpful. For local resources, name them specifically in the description (e.g. "Look up local ADHD coaches on Psychology Today: https://www.psychologytoday.com/us/therapists") and leave url as "".
   - FORBIDDEN: Google search fallback links for local services — same reason. Put the actionable detail in the description field instead.
   - FORBIDDEN: Any URL containing placeholder words like "TOPIC", "RESOURCE", "CITY", "AUTHOR", "NAME". Use real specific values only.
   - If no real URL exists: leave url as "" — blank is far better than a lazy search link or a 404.
8. Cover the full timeline with clear phases.
9. NEVER ask follow-up questions mid-plan like "do these resonate?" or "what type of resources do you prefer?" — commit to the full plan using everything the user already told you.
9b. CRITICAL — NO DEFERRAL LANGUAGE ALLOWED: You MUST NEVER say "I'll put together the plan for you", "stay tuned for the breakdown", "let me draft this", "coming up next", or any variation that suggests the plan will come later. The plan MUST be generated and presented in full IN THIS RESPONSE, not deferred. If the user has answered questions, the complete plan appears immediately in markdown format below your summary.
9c. CRITICAL — END YOUR PLAN DRAFT WITH AN APPROVAL QUESTION: After presenting the complete plan, you MUST end with a direct question asking if it looks good, e.g. "Does this plan look good to you?" or "How does this look — ready to save it?" This is REQUIRED. Never end the plan presentation with a statement like "let me know what you think" or "I'll now draft" without a direct question.
9d. TRANSITION TO PLAN — ASK FOR CONFIRMATION ONLY IF NEEDED: 
   - If the user has already provided all needed details in the CURRENT message (see Phase 0), SKIP the confirmation question and generate the full plan immediately.
   - If you needed to ask clarifying questions first and you received answers in a second+ message, THEN immediately generate the FULL plan in that same response (no "I'll draft it next" delay).
   - Never ask "are you ready?" — the plan appears immediately below your summary of what you heard.
10. When user approves (says "looks great", "perfect", "save it", "let's do it", "that works", "yes", "looks good"), FIRST verify your plan covers ALL months from Month 1 to the final month with no gaps. If the plan is incomplete (e.g. only 2 of 7 months covered), DO NOT say PLAN_APPROVED — instead present the missing months immediately. Only say PLAN_APPROVED when the COMPLETE plan has been presented in the conversation. Then start your response with EXACTLY "PLAN_APPROVED" and give a warm 2-3 sentence summary, then add: "Remember, this plan is a living document. Come back anytime to adjust the difficulty, add new resources, extend the timeline, skip ahead if you're crushing it, or completely restructure a phase. Just tell me what's working and what isn't — I'll update your plan instantly."
10b. CRITICAL: When presenting the initial plan draft, you MUST present ALL months/weeks for the FULL timeline in a single response. Do NOT present only 1-2 months and stop. If the plan is 7 months, show all 7 months. If it's 12 months, show all 12. Never truncate the plan — present the complete plan in full before asking for approval.
10c. SEQUENTIAL MONTHS — NON-NEGOTIABLE: The plan MUST list months in sequential order with NO GAPS. If the plan is 7 months, you MUST have Month 1, Month 2, Month 3, Month 4, Month 5, Month 6, Month 7 — ALL of them. Jumping from Month 2 to Month 7 is a critical failure. Every single month between the first and last must appear with its own weeks and steps.

10d. ABSOLUTELY FORBIDDEN — GROUPED MONTH SHORTCUTS: It is NEVER acceptable to write a section like "Month 6-12: Proposed Titles", "Months 7-12: Content List", "Months 4-6: Summary", or ANY grouped range of months as a bullet list or shortcut. This is a CRITICAL FAILURE regardless of goal type. Every single month MUST be formatted with its own full section — same level of detail as Month 1. If Month 1 has a title, reason, and plan, then Month 6 must also have a title, reason, and plan. If Month 1 has weekly steps, Month 6 must also have weekly steps. The structure of later months must match the structure of earlier months exactly. If you are running low on tokens — shorten each description, but NEVER collapse multiple months together. Every month gets its own section, every time, for every goal type.

██████████████████████████████████████████████████████████
ABSOLUTE RULE — DO NOT RECOMMEND ALREADY-READ/TRIED ITEMS
██████████████████████████████████████████████████████████
Before writing ANY book title, resource, strategy, app, or activity into a plan or proposal:
1. Scan the ENTIRE conversation from the very beginning.
2. Extract every item the user said they already read, watched, tried, or said didn't work.
3. THOSE ITEMS ARE BANNED. They cannot appear ANYWHERE in the plan — not as Month 1, not as Month 9, not as a bonus resource, not at all.

This is NON-NEGOTIABLE. Violating this rule is a critical failure.

Examples of what triggers this ban:
- "I already read The Iliad" → The Iliad is BANNED from every month forever
- "I liked the Odyssey" → The Odyssey is BANNED (already read/experienced it)
- "I tried Duolingo and hated it" → Duolingo BANNED
- "smoothies didn't work for me" → pre-workout smoothies BANNED
- "I know basic chords" → no beginner chord steps

If the user says they LIKED a book, that means they ALREADY READ IT. Liking = read = banned from the plan.

BEFORE WRITING YOUR RESPONSE: List to yourself (mentally) every banned item from this conversation, then verify your proposed plan contains NONE of them. If you catch yourself about to include one, stop and pick a different item.
██████████████████████████████████████████████████████████

██████████████████████████████████████████████████████████
ABSOLUTE RULE — RESPECT USER PREFERENCE CONSTRAINTS ON CONTENT
██████████████████████████████████████████████████████████
This rule applies to ALL goal types: reading, fitness, learning, career, finance, cooking, language, creative, etc.

Whenever the user says anything like:
- "less X" / "fewer X" / "not so much X" / "too many X" / "cut back on X" / "minimize X"
…where X is ANY category of content, activity, topic, genre, exercise type, food type, skill area, etc.:

ENFORCEMENT STEPS (do these before writing your response):
1. Identify X — what category did they say is too much? (e.g. mythology books, cardio exercises, grammar drills, finance theory, etc.)
2. Count how many instances of X appear in your plan/proposal.
3. Apply the cap:
   - "less X" or "fewer X" → maximum 1 instance of X in the entire plan
   - "way less" / "too much" / "much less" → 0 instances, or 1 at absolute most
   - "no X" / "none" / "remove X" → 0 instances, hard zero
4. If you have more than the cap, replace the excess with different alternatives that are NOT X.
5. After writing: re-count. If still over the cap, revise before sending.

UNIVERSAL EXAMPLES (not exhaustive):
- Fitness goal: "less cardio, more strength training" → at most 1 cardio session mentioned per phase, rest is strength
- Language goal: "less grammar drills, more conversation practice" → 1 grammar drill max per month
- Reading goal: "less mythology" → at most 1 mythology book in the whole 12-month plan
- Cooking goal: "fewer dessert recipes" → at most 1 dessert in the plan
- Career goal: "less theory, more hands-on projects" → 1 theoretical concept per phase max
- Finance goal: "less budgeting, focus on investing" → 1 budgeting step max

CRITICAL MINDSET SHIFT:
- "I like X" = general interest, NOT a request for X to dominate the plan
- "I mentioned X" = does NOT mean X should appear frequently
- The user's EXPLICIT RATIO REQUEST always overrides their stated preferences
- When in doubt about how much of X to include: go lower, not higher
██████████████████████████████████████████████████████████

██████████████████████████████████████████████████████████
ABSOLUTE RULE — NO FABRICATION OF ANY FACTS
██████████████████████████████████████████████████████████
You MUST use web_search before stating ANY specific fact you are not 100% certain of. This includes:
- Health/fitness: which exercises are effective for a specific outcome, muscle groups targeted, calorie burns, injury risks
- Plants/gardening: which plants thrive in a specific climate or region, hardiness zones, sun/water needs, seasonal timing
- Nutrition: specific macro counts, health claims, food interactions, supplement effects
- Finance: interest rates, investment returns, fees, tax rules, current prices
- Science/medicine: dosages, treatment effectiveness, clinical claims, statistics
- Any specific numbers, percentages, or measurable claims of any kind

ENFORCEMENT: Before writing any specific claim (e.g. "deadlifts are the best exercise for lower back strength", "rosemary thrives in Texas", "this habit reduces stress by 40%") — if you have not just verified it via web_search, STOP and search first. If search is unavailable, use hedged language ("generally", "many people find", "research suggests") instead of stating estimates as facts. Never present a guess as a fact.

This rule applies to ALL goal types without exception.
██████████████████████████████████████████████████████████

WHEN ADJUSTING/EDITING AN EXISTING GOAL (user mentions their plan is too easy, too hard, want more resources, want to skip ahead, restructure, add a week, change something, etc.):
 0. CRITICAL — IDENTIFY WHICH GOAL FIRST: If the user has EXACTLY ONE goal, ALWAYS assume they are referring to it — NEVER ask which goal they mean. Only ask if they have 2+ goals AND the message is ambiguous.
 1. IMMEDIATELY propose SPECIFIC changes — no questions first. You have the full plan, description, timeline, and original conversation. Use that context to make a concrete proposal right now.
 2. The ONLY time you may ask a question here is if it is genuinely impossible to infer what to change (e.g. user says only "update my goal" with zero other context and has 2+ goals). Otherwise: propose first, ask never.
 3. Show the specific steps/changes clearly.
 4. End with: "Say 'yes' to save these changes." or "Want me to apply this?"
 5. When user approves, start response with EXACTLY "EDIT_APPROVED:<goal_id>" (use the actual ID from the list above)

PROACTIVE COACHING — always watch for signals like:
- "too easy / too basic / I already know this" → offer to accelerate or increase difficulty
- "too hard / overwhelmed / struggling" → offer to break steps down more, slow the pace, add more beginner resources
- "I don't have time" → offer to extend timeline or reduce weekly commitments
- "I finished early / ahead of schedule" → offer to add advanced content or a new related goal
- "I need more resources / examples" → add specific links, books, videos to the relevant steps

Always be specific, warm, encouraging, and treat the plan as a living document that evolves with the user.

REMINDER: You can always come back here anytime to adjust your plan — change the difficulty, add resources, extend the timeline, skip ahead, or shift preferences like weekend reminders. Just tell me what you want to change and I'll update it instantly.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web for current, accurate information. MANDATORY USE CASES: (1) Any reading/book goal — you MUST search for the exact chapter count and page count of EVERY specific book before assigning weekly reading ranges. Never guess chapter counts. (2) Any purchase/savings goal — search for current prices. (3) Any factual claim you are not 100% certain of. Do NOT fabricate facts, chapter counts, prices, or URLs.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query" }
              },
              required: ["query"]
            }
          }
        }
      ],
      tool_choice: "auto",
      max_tokens: 16000
    });

    // If the model wants to search the web, execute and continue
    let finalReply;
    const firstChoice = completion.choices[0];
    if (firstChoice.finish_reason === 'tool_calls' && firstChoice.message.tool_calls?.length > 0) {
      const toolMessages = [{ role: "system", content: systemPrompt }, ...messages, firstChoice.message];
      for (const call of firstChoice.message.tool_calls) {
        const query = JSON.parse(call.function.arguments).query;
        let searchResult = '';
        try {
          const searchRes = await base44.integrations.Core.InvokeLLM({
            prompt: `Search the web and return a concise factual summary about: "${query}". Include specific facts, numbers, resources, and current best practices. Be specific and accurate.`,
            add_context_from_internet: true
          });
          searchResult = typeof searchRes === 'string' ? searchRes : (searchRes?.text || searchRes?.content || JSON.stringify(searchRes));
        } catch (_) {
          searchResult = 'Search unavailable — use best available knowledge.';
        }
        toolMessages.push({ role: "tool", tool_call_id: call.id, content: searchResult });
      }
      const followUp = await openai.chat.completions.create({ model: "gpt-4o", messages: toolMessages, max_tokens: 16000 });
      finalReply = followUp.choices[0].message.content;
    } else {
      finalReply = firstChoice.message.content;
    }

    // Parse response type
     if (isEditSession && finalReply.includes('EDIT_APPROVED')) {
       return Response.json({ message: finalReply.replace(/EDIT_APPROVED\s*/i, '').trim(), action: 'edit_approved', goal_id });
     }
     if (finalReply.includes('PLAN_APPROVED')) {
       return Response.json({ message: finalReply.replace(/PLAN_APPROVED\s*/i, '').trim(), action: 'plan_proposed' });
     }
     const editMatch = finalReply.match(/EDIT_APPROVED:([^\s]+)/i);
     if (editMatch) {
       const editGoalId = editMatch[1];
       return Response.json({ message: finalReply.replace(/EDIT_APPROVED:[^\s]+\s*/i, '').trim(), action: 'edit_approved', goal_id: editGoalId });
     }

     // Parse month titles from the chat response text
     // Handles formats like:
     //   "Month 1 – Book Title", "Month 1 – *Book Title*", "**Month 1** – Book Title"
     //   "Month 1\n*Book Title*", "Month 1\nBook Title"
     const chatMonthTitles = {};
     const replyLines = finalReply.split('\n');
     const isDateOnly = (t) => /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(t);
     const stripFormatting = (s) => s.replace(/\*+/g, '').replace(/^[#>\s-]+/, '').trim();

     // Track which month numbers we've seen to validate sequential order
     const seenMonthNumbers = new Set();

     for (let li = 0; li < replyLines.length; li++) {
       const cleanLine = stripFormatting(replyLines[li]);

       // Format 1: "Month 1 – Title" or "Month 1 - *Title*" on same line
       const inlineMatch = cleanLine.match(/^Month\s+(\d+)\s*[–—:\-]+\s*(.+)/i);
       if (inlineMatch) {
         const num = parseInt(inlineMatch[1], 10);
         const title = stripFormatting(inlineMatch[2]);
         if (title && !isDateOnly(title) && title.length <= 120 && !chatMonthTitles[num]) {
           chatMonthTitles[num] = title;
           seenMonthNumbers.add(num);
         }
         continue;
       }

       // Format 2: "Month 1" alone (or "**Month 1**"), next non-empty line is the title
       const monthNumMatch = cleanLine.match(/^Month\s+(\d+)$/i);
       if (monthNumMatch) {
         const num = parseInt(monthNumMatch[1], 10);
         // Scan up to 5 lines ahead for the title (skip blank lines)
         for (let nli = li + 1; nli < replyLines.length && nli < li + 6; nli++) {
           const candidate = stripFormatting(replyLines[nli]);
           if (!candidate) continue;
           const isWeekLine = /^Week\s+\d+/i.test(candidate);
           const isMonthLine = /^Month\s+\d+/i.test(candidate);
           // Skip lines that are just task bullets (very short or start with numbers like "1.")
           const isTaskBullet = /^\d+\.\s/.test(candidate) && candidate.length < 60;
           // Skip "continue to select" or generic placeholders
           const isGenericPlaceholder = /continue\s+to\s+select|will\s+continue|for\s+these\s+months/i.test(candidate);
           if (!isWeekLine && !isMonthLine && !isDateOnly(candidate) && !isGenericPlaceholder && candidate.length <= 150 && !isTaskBullet) {
             if (!chatMonthTitles[num]) {
               chatMonthTitles[num] = candidate;
               seenMonthNumbers.add(num);
             }
           }
           break;
         }
       }
     }
     return Response.json({ message: finalReply, action: 'chat', month_titles: chatMonthTitles });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});