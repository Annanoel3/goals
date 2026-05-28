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
      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are extracting a structured goal plan from a planning conversation. Return ONLY valid JSON, no markdown fences. ${monthsHint} CRITICAL: Even if the conversation only briefly mentions later months without weekly detail, you MUST still generate EXACTLY 4 weeks for EVERY month. Generate EXACTLY 4 steps per month. Each step IS one week. phase must be 'Month X, Week Y' (e.g. 'Month 1, Week 1', 'Month 2, Week 3'). title starts with 'Week 1:', 'Week 2:', 'Week 3:', or 'Week 4:' followed by a brief focus. description = 2-4 sentences. tips_and_guidance = 3-5 activities as a newline-separated list; if daily practice ALWAYS include 'Do [specific action] every day'. step_resources = [{title, specific_details}] main book/resource. No daily breakdowns.`
          },
          {
            role: "user",
            content: `Extract the FINAL agreed plan from this conversation:

${conversationText}

${monthsHint}

Return JSON (no markdown) in EXACTLY this structure. CRITICAL STRUCTURAL RULE FOR ALL GOALS 1+ MONTHS:
        ${monthsRule}
- EVERY SINGLE MONTH must have EXACTLY 4 steps (Week 1, Week 2, Week 3, Week 4). phase='Month X'. title='Week N: focus'. 4 steps × 12 months = 48 total steps.
- REQUIRED: phase must be 'Month X, Week Y' (e.g. 'Month 1, Week 1', 'Month 2, Week 3'). ALWAYS include both month AND week number in phase.
- NEVER combine weeks or months: "Week 1-2", "Weeks 3-4", "Months 4-6" are STRICTLY FORBIDDEN. Each STEP = exactly ONE week. phase='Month X' (month only). title='Week N: brief focus'. Exactly 4 steps per month.

MONTH TITLES (CRITICAL FOR ALL GOALS):
EVERY month MUST have a descriptive title that reflects its milestones or theme. For a reading goal: book title. For fitness: training phase. For learning: skill phase. For business: growth stage.
Format in output: "Month 1 – Book Title" or "Month 1 – Introduction Phase" (with em dash or hyphen).
This applies to ALL goal types. Users should see meaningful milestone titles, not just "Month 1".
- For goals under 1 month, just use "Week 1", "Week 2" phases directly.

NOTIFICATION FREQUENCY DETECTION:
Analyze the conversation for clues about how often the user wants to be reminded:
- Daily tasks / morning routine / meditation / exercise / practice → "daily"
- Weekday focus only (Mon-Fri) / work-related → "weekdays"
- Once per week check-in / milestone goals → "weekly"
- Multiple times per week → "3x_per_week" or "2x_per_week"
- If unclear or they're doing daily actions → default to "daily"
Set "notification_frequency" in the returned JSON to one of: "daily", "weekdays", "weekly", "3x_per_week", "2x_per_week", "once_per_week"

GRANULARITY RULES — choose the right level of detail per goal type:

MULTI-MONTH GOALS (2+ months): ALWAYS use week-steps with rich descriptions. No daily breakdowns. 4 steps per month, each with 2-4 sentences in description. TYPE A and TYPE B granularity only applies to single-month goals.

TYPE A — DAILY PRACTICE GOALS (single-month goals only) (instruments, language learning, fitness/exercise, meditation, journaling, coding practice, drawing, singing, martial arts, sport drills):
  - Each week must include a DAILY breakdown: Monday through Sunday (or Day 1–7), each with a specific task.
  - Example for "Learn Guitar, Month 1 Week 1":
      Monday: Practice open chords G, C, D for 20 min
      Tuesday: Repeat Monday's chords + practice transitions
      Wednesday: Learn Em and Am chords
      ...and so on through Sunday.
  - Mark these steps as is_daily_habit: true.
  - The step title should be the day (e.g. "Monday – Chord Practice") and description contains what to do.

TYPE B — MILESTONE/PROJECT GOALS (save money, find a job, start a business, write a book, improve relationships, mental health, happiness, productivity, home projects):
  - Each week needs only 2-4 key actionable tasks — NOT a daily breakdown.
  - Steps should be concrete milestones or actions, not daily habits.
  - Example for "Be Happier, Month 2 Week 1":
      Step: "Schedule one social activity this week"
      Step: "Journal about 3 things you're grateful for (3x this week)"
      Step: "Read Chapter 4 of The Happiness Advantage"

DECISION RULE: Look at the goal's category and description. If it involves a SKILL that requires daily repetition to build muscle memory or habit → TYPE A. If it's about achieving outcomes through periodic actions and milestones → TYPE B. When in doubt, lean TYPE B (fewer, clearer steps per week).

READING & BOOK GOALS: Each month = 1 book split into 4 week-phases. Week 1 = first 25% of book, Week 2 = 25-50%, Week 3 = 50-75%, Week 4 = finish + brief reflection notes. NEVER compress a whole book into 1 week-phase. If the goal involves reading EVERY DAY (e.g. "read 12 books in 12 months", "daily reading habit", "read 30 pages a day"), set is_daily_habit: true on each weekly reading step. If reading is occasional/milestone-based, leave is_daily_habit: false.

TOKEN PRIORITY RULE: Completing ALL ${detectedMonths} months x 4 weeks = ${detectedMonths * 4} total week-phases is the HIGHEST priority. Trade depth for coverage always. Use 2-4 steps per week-phase. Never sacrifice later weeks just to add detail to earlier ones.

IMPORTANT: Generate 2-4 specific, actionable tasks per week-phase. Keep descriptions to 1 sentence each. CRITICAL: If the user said "by end of year" or "by [month]", calculate the EXACT number of months from today (${today}) to that date and use that as the timeline. Do NOT use a generic number.
{
  "title": "concise goal title",
  "description": "what the user wants to achieve",
  "timeline": "e.g. 5 months",
  "target_date": "YYYY-MM-DD calculated from today ${today}",
  "category": "one of: learning, health, career, finance, relationships, personal, creative, other",
  "notification_frequency": "daily|weekdays|weekly|3x_per_week|2x_per_week|once_per_week — inferred from conversation",
  "plan_summary": "2-3 sentence summary of the overall plan",
  "steps": [
    {
      "title": "specific, granular subtask (e.g., 'Complete Lesson 2: Present Tense Conjugation')",
      "description": "detailed explanation of what to do and why",
      "phase": "REQUIRED format: 'Month X, Week Y' — e.g. 'Month 1, Week 1', 'Month 1, Week 2', 'Month 3, Week 4'. Always include both month AND week.",
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
      "tips_and_guidance": "specific advice, common pitfalls, best practices for this step",
      "is_daily_habit": false,
      "sub_steps": [
        {
          "title": "granular sub-step (optional — use if step needs 2-3 detailed actions)",
          "description": "what specifically to do",
          "priority": "low|medium|high",
          "due_date": "YYYY-MM-DD"
        }
      ]
    }
  ]
}

CRITICAL:
0b. CRITICAL — For each step, set "is_daily_habit": true if the step is something the user must DO EVERY DAY (e.g. morning affirmations, daily meditation, daily journaling, daily gratitude, daily exercise, daily reading, morning routine, nightly review, practice, rehearsal). The words "daily", "every day", "each morning", "each night", "routine", "practice", "affirmation", "habit" are strong signals. ALSO: if the goal is something like "read 12 books in 12 months", "read X books this year", or any goal requiring consistent daily reading to hit the target — each weekly reading step MUST be is_daily_habit: true. Set it false only for one-time tasks or milestones.
0. NEVER skip weeks or phases. If you have Month 1 Week 1, Month 1 Week 2, Month 1 Week 3 — ALL must appear. No gaps. If a month has 4 weeks, all 4 weeks must have steps. Do not jump from Week 1 to Week 3.
1. Generate 2-4 specific steps per week-phase. Coverage of ALL week-phases is the top priority. Keep descriptions brief (1 sentence each).
2. FOR EVERY STEP, include step_resources with specific links and guidance (videos, books, articles, tools, websites, local venues/clubs if discussed)
3. FOR EVERY STEP, include measurable success_criteria so users know exactly when they've completed it
4. FOR EVERY STEP, include tips_and_guidance with specific advice and common pitfalls to avoid
5. CRITICAL: Any resource, link, app, book, local class, club, or tool mentioned ANYWHERE in the conversation must appear in the step_resources of the most relevant step. Do not drop anything that was discussed.
5c. BUDGET ENFORCEMENT: Check the conversation for whether the user indicated a budget or said "free only". If the user said no budget / free only → every step_resource must be free (YouTube, free apps, Google search links, free PDFs). NEVER include paid books or paid courses. If the user gave a budget, respect it. If unclear, default to free only.
5b. RESOURCE LINK RULES — CRITICAL — BROKEN LINKS ARE WORSE THAN NO LINKS:
   - NEVER guess or fabricate article URLs (e.g. additudemag.com/some-article, psychologytoday.com/blog/...). These will 404. FORBIDDEN.
   - NEVER construct a URL by guessing a path on a domain you know exists. Only use URLs you are certain work.
   - SAFE URL FORMATS (always use these — replace ALL CAPS placeholders with real, specific values):
     * YouTube search: https://www.youtube.com/results?search_query=beginner+guitar+chords (use the actual topic, not "TOPIC")
     * Amazon book search: https://www.amazon.com/s?k=Atomic+Habits+James+Clear (use the actual title and author)
     * Google search fallback: https://www.google.com/search?q=CHADD+ADHD+support+groups+Austin+TX (use specific real terms)
     * Udemy search: https://www.udemy.com/courses/search/?q=python+for+beginners (use actual topic)
     * Coursera search: https://www.coursera.org/search?query=data+science (use actual topic)
     * App root domain only (e.g. https://www.duolingo.com) — ONLY if 100% certain.
   - FORBIDDEN: Google Maps search links (https://www.google.com/maps/search/...) — lazy and unhelpful. For local resources, describe them specifically in the description field (e.g. "Search Psychology Today therapist finder at https://www.psychologytoday.com/us/therapists for ADHD coaches in Austin") and leave url as "".
   - FORBIDDEN: Placeholder text in URLs like "TOPIC", "RESOURCE+NAME", "RESOURCE+TYPE", "NEAR+CITY". Every URL must use real specific values.
   - FORBIDDEN: Any invented URL path (e.g. /blog/article-name, /adhd-tips). If unsure of the exact path, leave url as "".
   - If you have no real URL: leave url as "" — blank is far better than a broken or lazy link.
6. If local resources were discussed (clubs, classes, meetups, venues), describe them specifically in the description field of the step_resource. Do NOT use Google Maps search URLs.
7. This removes all excuses — users have everything they need to execute.`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);

      // Ensure all steps have required fields + extract month titles
       const monthTitles = {};
       plan.steps = (plan.steps || []).map(step => {
         // Store month title for later use
         if (step.phase && step.month_title) {
           const monthMatch = step.phase.match(/Month\s+(\d+)/i);
           if (monthMatch) {
             const monthNum = parseInt(monthMatch[1], 10);
             if (!monthTitles[monthNum]) {
               monthTitles[monthNum] = step.month_title;
             }
           }
         }
         return {
           ...step,
           step_resources: step.step_resources || [],
           success_criteria: step.success_criteria || [],
           tips_and_guidance: step.tips_and_guidance || ""
         };
       });
       plan.month_titles = monthTitles;

      // VALIDATE: ensure no gaps in phases/timeline with week structure for 3+ month goals
      const validatePlanCompleteness = (p) => {
        if (!p.steps || p.steps.length === 0) return { valid: false, error: "No steps generated" };
        
        // Parse timeline to determine expected number of months
        const timelineMatch = p.timeline?.match(/(\d+)\s*month/i);
        const expectedMonths = timelineMatch ? parseInt(timelineMatch[1], 10) : null;
        
        if (!expectedMonths) return { valid: true }; // Can't validate without timeline
        
        // Count phases present
        const phases = new Set(p.steps.map(s => s.phase || 'Uncategorized').filter(ph => ph !== 'Uncategorized'));
        const phaseArray = Array.from(phases).sort();
        
        // For 1+ month goals: enforce week structure (Month X Week Y)
        if (expectedMonths >= 1) {
          const monthWeekCounts = {};
          let hasWeekStructure = false;
          
          phaseArray.forEach(phase => {
            const weekMatch = phase.match(/Month (\d+)[\s,].*Week (\d+)/i);
            const monthMatch = phase.match(/Month (\d+)/i);
            
            if (weekMatch) {
              hasWeekStructure = true;
              const monthNum = parseInt(weekMatch[1], 10);
              const weekNum = parseInt(weekMatch[2], 10);
              if (!monthWeekCounts[monthNum]) monthWeekCounts[monthNum] = new Set();
              monthWeekCounts[monthNum].add(weekNum);
            } else if (monthMatch && !weekMatch) {
              // Has month but no week structure — this is a problem for 3+ month goals
              const monthNum = parseInt(monthMatch[1], 10);
              if (!monthWeekCounts[monthNum]) monthWeekCounts[monthNum] = new Set();
              monthWeekCounts[monthNum].add(0); // Placeholder for "no week"
            }
          });
          
          // ALL months MUST use week structure (weeks are required for every month)
          for (let month = 1; month <= expectedMonths; month++) {
            if (!monthWeekCounts[month]) {
              return {
                valid: false,
                error: `Plan structure incomplete: Month ${month} is missing entirely (expected all months 1-${expectedMonths} with 4 weeks each).`
              };
            }
          }
          
        } else if (expectedMonths < 1) {
          // For goals under 1 month, just use weeks (Week 1, Week 2, etc.)
          const weekCounts = {};
          phaseArray.forEach(phase => {
            const weekMatch = phase.match(/Week (\d+)/i);
            if (weekMatch) {
              const weekNum = parseInt(weekMatch[1], 10);
              weekCounts[weekNum] = true;
            }
          });
          
          if (Object.keys(weekCounts).length === 0) {
            return {
              valid: false,
              error: `Plan structure missing: expected week-based phases for goals under 1 month.`
            };
          }
        }
        
        // Check minimum step count
        const stepsPerPhase = {};
        p.steps.forEach(s => {
          const phase = s.phase || 'Uncategorized';
          stepsPerPhase[phase] = (stepsPerPhase[phase] || 0) + 1;
        });
        
        const avgStepsPerMonth = expectedMonths ? p.steps.length / expectedMonths : 0;
        if (avgStepsPerMonth < 3) {
          return {
            valid: false,
            error: `Insufficient detail: generated only ${p.steps.length} total steps for ${expectedMonths} months (~${Math.round(avgStepsPerMonth)} per month). Expected 15-20+ per month.`
          };
        }
        
        return { valid: true };
      };
      
      const validation = validatePlanCompleteness(plan);
      if (!validation.valid) {
        // Regenerate with stricter instructions
        const retryResponse = await openai.chat.completions.create({
           model: "gpt-4o",
           messages: [
             {
               role: "system",
               content: `You are extracting a structured goal plan. CRITICAL RULES: Every month MUST be expanded into exactly 4 weeks (Week 1, Week 2, Week 3, Week 4). Never output a bare 'Month X' phase — always use 'Month X Week Y' format.
        1. EVERY MONTH from Month 1 through the final month MUST have steps. NO GAPS.
        2. EVERY MONTH must have EXACTLY 4 steps — one per week. phase='Month X, Week Y' format required.
        3. For a ${plan.timeline} goal, generate steps for ALL ${detectedMonths} months.
        4. Return ONLY valid JSON, no markdown fences.
        5. If previous extraction failed: "${validation.error}", you MUST fix it now.`
            },
            {
              role: "user",
              content: `Extract the plan from this conversation. CRITICAL — the previous extraction was incomplete or had gaps. Fix it now by including EVERY month and week with full detail:\n\n${conversationText}\n\n${monthsHint}\n\nReturn the SAME JSON structure, but with complete phases and steps for ALL ${detectedMonths || 'stated'} months.`
            }
          ],
          max_tokens: 16000,
        response_format: { type: "json_object" }
        });
        
        const retryPlan = JSON.parse(retryResponse.choices[0].message.content);
        retryPlan.steps = (retryPlan.steps || []).map(step => ({
          ...step,
          step_resources: step.step_resources || [],
          success_criteria: step.success_criteria || [],
          tips_and_guidance: step.tips_and_guidance || ""
        }));
        
        const retryValidation = validatePlanCompleteness(retryPlan);
        if (!retryValidation.valid) {
          return Response.json({ 
            error: `Plan generation failed validation: ${retryValidation.error}. Please try again with a clearer timeline or fewer goals.` 
          }, { status: 400 });
        }
        
        return Response.json({ plan: retryPlan });
      }

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
      
      // Ensure notification_frequency is set (fallback to daily if not detected)
      if (!plan.notification_frequency) {
        plan.notification_frequency = 'daily';
      }
      
      return Response.json({ plan, month_titles: plan.month_titles || {} });
    }

    // ── APPLY EDIT: commit approved edits to an existing goal ─────────────────
    if (mode === 'apply_edit') {

      // Fetch existing goal & steps for context (user-scoped so RLS returns their data)
      const existingGoal = await base44.entities.Goal.list().then(all => all.find(g => g.id === goal_id));
      const existingSteps = await base44.entities.GoalStep.filter({ goal_id });

      const stepsJson = JSON.stringify(existingSteps.map(s => ({
        id: s.id, title: s.title, phase: s.phase, priority: s.priority, due_date: s.due_date, order_index: s.order_index, status: s.status
      })));

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You extract approved goal edits from a conversation. Return ONLY valid JSON, no markdown. CRITICAL: Extract EVERY proposed step from the planner's response, not just a sample. If the planner proposed 30 steps, return all 30.`
          },
          {
            role: "user",
            content: `Current goal: ${existingGoal?.title || 'Unknown'}
Current steps: ${stepsJson}

Conversation about edits:
${conversationText}

Extract the APPROVED changes. CRITICAL RULES:
1. If the planner proposed new months/weeks (e.g., "Here's Month 6-12" or "Here are the missing months"), extract EVERY SINGLE STEP from that proposal.
2. Do NOT omit any steps. Count the steps in the proposal and ensure your steps_to_add array has the SAME count.
3. For each step, include: title, description, phase (e.g. "Month 6, Week 1"), priority, due_date, order_index, step_resources, success_criteria, tips_and_guidance.
4. Preserve the exact phase naming from the proposal (if it says "Month 6, Week 1", use exactly that).
5. TIMELINE RESTRUCTURE: If the planner said it is restructuring the entire plan (e.g. "I'm restructuring your full plan", "spreading across X months", "rebuilding from scratch"), then:
   a) Add ALL new steps from the proposal to steps_to_add.
   b) Put ALL existing step IDs that have status "pending" or "in_progress" into steps_to_delete (keep only "completed" steps).
   c) Update goal_updates with the new timeline and target_date.
   This ensures the old structure is fully replaced and there are no duplicate/conflicting endpoints.

Return JSON:
{
  "goal_updates": {
    "title": "optional - only if changed",
    "description": "optional - only if changed",
    "plan_summary": "optional - only if changed",
    "timeline": "optional - only if changed",
    "target_date": "YYYY-MM-DD - optional - only if changed"
  },
  "steps_to_add": [
    { "title": "...", "description": "...", "phase": "...", "priority": "low|medium|high|critical", "due_date": "YYYY-MM-DD", "order_index": 999, "step_resources": [], "success_criteria": [], "tips_and_guidance": "" }
  ],
  "steps_to_update": [
    { "id": "existing step id", "title": "...", "description": "...", "phase": "...", "priority": "...", "due_date": "YYYY-MM-DD" }
  ],
  "steps_to_delete": ["step_id_1", "step_id_2"]
}
Only include fields that actually changed. today = ${today}`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const edits = JSON.parse(extractionResponse.choices[0].message.content);

      // VALIDATE: ensure no steps are duplicated or missing from complete phases
      if (edits.steps_to_add && edits.steps_to_add.length > 0) {
        const allStepsAfterEdit = [
          ...existingSteps.filter(s => !edits.steps_to_delete?.includes(s.id)),
          ...edits.steps_to_add
        ];
        
        const phaseCheck = {};
        allStepsAfterEdit.forEach(s => {
          const phase = s.phase || 'Uncategorized';
          if (!phaseCheck[phase]) phaseCheck[phase] = [];
          phaseCheck[phase].push(s.title);
        });
        
        // Log for debugging — ensure phases are sequential
        const phaseNames = Object.keys(phaseCheck).sort();
        // Warn if there are obvious gaps (e.g., Month 1, Month 3 but no Month 2)
        const monthPhases = phaseNames.filter(p => /Month \d+/.test(p));
        if (monthPhases.length > 1) {
          const months = monthPhases.map(p => parseInt(p.match(/\d+/)[0])).sort((a, b) => a - b);
          for (let i = 0; i < months.length - 1; i++) {
            if (months[i + 1] - months[i] > 1) {
              // Gap detected — log but still apply (user may know what they're doing)
              console.warn(`Gap detected: Month ${months[i]} to Month ${months[i + 1]}`);
            }
          }
        }
      }

      // Apply goal-level updates (user-scoped so created_by is preserved)
      if (edits.goal_updates && Object.keys(edits.goal_updates).length > 0) {
        await base44.entities.Goal.update(goal_id, edits.goal_updates);
      }

      // Add new steps (user-scoped so created_by is set correctly for RLS)
      if (edits.steps_to_add?.length > 0) {
        for (const step of edits.steps_to_add) {
          const createdStep = await base44.entities.GoalStep.create({
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

          // Create sub-steps if provided
          if (step.sub_steps?.length > 0) {
            for (const subStep of step.sub_steps) {
              await base44.entities.GoalStep.create({
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
        }
      }

      // Update existing steps
      if (edits.steps_to_update?.length > 0) {
        for (const step of edits.steps_to_update) {
          const { id, ...updates } = step;
          await base44.entities.GoalStep.update(id, updates);
        }
      }

      // Delete steps
      if (edits.steps_to_delete?.length > 0) {
        for (const stepId of edits.steps_to_delete) {
          await base44.entities.GoalStep.delete(stepId);
        }
      }

      return Response.json({ success: true, edits });
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
      const currentSteps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id });
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

PHASE 1 — GATHER INFO FIRST (STRICTLY REQUIRED before drafting any plan):
1. On the FIRST response, ask ALL the questions you need in one numbered list. Do NOT split them across multiple messages. Ask everything at once. CRITICAL RULES FOR QUESTIONS:
   a) NEVER ask two questions that cover the same topic (e.g. "experience level" and "prior attempts" are the same — merge them into ONE question like "What's your current experience with this, including any past attempts that worked or didn't?")
   b) Every question must have a direct, clear purpose in shaping the plan — if you ask about fears/obstacles, TELL the user how you'll use that answer (e.g. "What obstacles or fears do you have? I'll build specific contingency steps into your plan to address them.")
   c) FOR PURCHASE/SAVINGS GOALS (buying a car, saving for a product, down payment, etc.): Before asking price questions, use your knowledge or web search to look up the likely MSRP or price range of the specific item mentioned. Then reference it directly in the question, e.g. "The 2026 Toyota Camry has an MSRP of around $29,000. Are you looking to save the full purchase price, or are you planning to finance and just need a down payment? What's your target amount?" — do NOT ask a generic "how much do you need to save" question.
   d) The questions to ask are:
      - ONE combined experience + prior attempts question (e.g. "What's your current level with this, and have you tried before? What worked or didn't?")
      - The specific target amount / outcome question (for finance goals: reference the real price as above)
      - How much can they realistically commit per month (time or money)
      - What obstacles or fears do they have? (always clarify: "I'll build specific contingency steps into your plan to address these")
      - Any specific deadline or target date? — ONLY ask this if the user has NOT already mentioned a deadline or timeframe in their goal description. If they said "by end of 2026", "before Christmas", "in 6 months", etc., skip this question entirely and use that date.
      - FOR HEALTH/FITNESS GOALS ONLY: What time of day do they prefer to work out/exercise?
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
${monthsRule}
4. STRICT PHASE NAMING RULES — VIOLATIONS ARE NOT ACCEPTABLE:
   - NEVER combine weeks: "Week 1-2", "Week 3-4", "Weeks 5-6" are ALL FORBIDDEN. Every week is its own entry: "Month 1, Week 1", "Month 1, Week 2", etc.
   - NEVER combine months. Every month is its own entry: "Month 4", "Month 5", "Month 6".
   - NEVER use ranges. Each phase = exactly ONE week.
   - EVERY month must have all 4 weeks. Never give Month 1 four weeks and then just "Month 2" with no weeks.

   GRANULARITY — choose the right level based on goal type:
   - DAILY PRACTICE GOALS (instrument, language, fitness, coding, drawing, martial arts): break each week into daily tasks (Monday–Sunday or Day 1–7). Mark as is_daily_habit: true.
   - MILESTONE/PROJECT GOALS (finance, career, business, travel, concrete measurable outcomes): 2-4 specific action steps per week — no daily breakdown needed.
   - SOFT/PERSONAL GROWTH GOALS (self-confidence, anxiety, boundaries, saying no, mindset, emotional wellbeing, relationships, happiness): 3-7 reflection prompts or practice goals per week — NO daily breakdown, NO rigid scheduling. Keep it gentle and flexible.
   - Rule of thumb: Does this skill require daily repetition to build? → daily. Is it about outcomes through periodic effort? → weekly milestones.
5. Create a detailed phased plan with milestones (Month 1, Month 2, Week 1, etc.) that EXACTLY fits the user's stated timeline. If they say "by December 2026" (7 months), your plan must FULLY cover all 7 months — not 6, not 5, but all 7. Every month must have content. Condense, prioritize, and fit everything within the full window — do not stop early.
   CRITICAL ENFORCEMENT: If the timeline spans 12 months, there MUST be 12 months of content (Month 1 through Month 12). If the user says "by end of year" and today is May, calculate the exact months remaining and FILL EVERY SINGLE MONTH/WEEK with relevant steps. No shortcuts, no stopping at 5 months when the timeline is longer. The plan must span the entire stated duration.
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
9b. CRITICAL — END YOUR PLAN DRAFT WITH AN APPROVAL QUESTION: After presenting the complete plan, you MUST end with a direct question asking if it looks good, e.g. "Does this plan look good to you?" or "How does this look — ready to save it?" This is REQUIRED. Never end the plan presentation with a statement like "let me know what you think" or "I'll now draft" without a direct question.
9c. TRANSITION TO PLAN — ALWAYS ASK FOR CONFIRMATION FIRST: Once you have gathered all the information you need, your next message must be a short confirmation question asking if the user is ready for you to build the plan. For example: "Great, I have everything I need! Ready for me to build your full plan?" or "Perfect — shall I put together your complete plan now?" ONLY after the user confirms (says "yes", "go ahead", "ready", etc.) should you write out the full plan. This ensures the user is engaged and the plan appears in a fresh, focused response.
10. When user approves (says "looks great", "perfect", "save it", "let's do it", "that works", "yes", "looks good"), FIRST verify your plan covers ALL months from Month 1 to the final month with no gaps. If the plan is incomplete (e.g. only 2 of 7 months covered), DO NOT say PLAN_APPROVED — instead present the missing months immediately. Only say PLAN_APPROVED when the COMPLETE plan has been presented in the conversation. Then start your response with EXACTLY "PLAN_APPROVED" and give a warm 2-3 sentence summary, then add: "Remember, this plan is a living document. Come back anytime to adjust the difficulty, add new resources, extend the timeline, skip ahead if you're crushing it, or completely restructure a phase. Just tell me what's working and what isn't — I'll update your plan instantly."
10b. CRITICAL: When presenting the initial plan draft, you MUST present ALL months/weeks for the FULL timeline in a single response. Do NOT present only 1-2 months and stop. If the plan is 7 months, show all 7 months. If it's 12 months, show all 12. Never truncate the plan — present the complete plan in full before asking for approval.
10c. SEQUENTIAL MONTHS — NON-NEGOTIABLE: The plan MUST list months in sequential order with NO GAPS. If the plan is 7 months, you MUST have Month 1, Month 2, Month 3, Month 4, Month 5, Month 6, Month 7 — ALL of them. Jumping from Month 2 to Month 7 is a critical failure. Every single month between the first and last must appear with its own weeks and steps.

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

Always be specific, warm, encouraging, and treat the plan as a living document that evolves with the user.`;
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
            description: "Search the web for current, accurate information. Use this whenever you need factual data, current best practices, research-backed advice, specific resources, prices, local services, or any topic where you are not 100% certain of the accuracy. Do NOT give advice or plans based purely on imagination — search first.",
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
          const searchRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
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

     return Response.json({ message: finalReply, action: 'chat', month_titles: {} });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});