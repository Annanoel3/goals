import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import OpenAI from "npm:openai";

Deno.serve(async (req) => {
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { messages, mode, goal_id } = body;
    const today = new Date().toISOString().split('T')[0];
    const conversationText = (messages || []).map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');

    // ── EXTRACT: parse conversation into structured milestone plan ────────────
    if (mode === 'extract_plan') {
      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You extract a milestone-based goal plan from a planning conversation. This goal has NO timeline — it is milestone-driven, not time-driven.

Return ONLY valid JSON, no markdown fences.

Structure:
- milestones: ordered list of major milestones (think "chapters" or "phases" of the journey). Each milestone = a significant achievement on the path to the goal.
- Each milestone has tasks: concrete, actionable steps to reach that milestone.
- Each task may optionally have subtasks: granular actions within that task.

RULES:
- 3 to 8 milestones typically. More if the goal is complex.
- 3 to 7 tasks per milestone.
- 0 to 4 subtasks per task (only when genuinely useful).
- Milestone titles should be achievement-framed: "Launch MVP", "Land First Client", "Complete First Draft", "Hit 100 Subscribers" — not vague like "Phase 1".
- Task titles: specific and actionable. "Write homepage copy" not "Work on website".
- NO timeline, NO due dates, NO month numbers.
- is_daily_habit: true only for tasks that require daily repetitive action (e.g. "Write 500 words every day").

Return this exact JSON:
{
  "title": "concise goal title",
  "description": "what the user wants to achieve",
  "plan_summary": "2-3 sentence overview of the milestone journey",
  "category": "learning|health|career|finance|relationships|personal|creative|other",
  "milestones": [
    {
      "title": "Milestone title (achievement-framed)",
      "description": "What achieving this milestone means and why it matters",
      "order_index": 0,
      "tasks": [
        {
          "title": "Specific actionable task",
          "description": "What to do and why",
          "order_index": 0,
          "is_daily_habit": false,
          "subtasks": [
            {
              "title": "Specific subtask",
              "description": "Granular action",
              "order_index": 0
            }
          ]
        }
      ]
    }
  ]
}`
          },
          {
            role: "user",
            content: `Extract the milestone plan from this conversation:\n\n${conversationText}`
          }
        ],
        max_tokens: 8000,
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);
      console.log(`[milestonePlannerChat] Extracted plan: ${plan.milestones?.length} milestones`);
      return Response.json({ plan });
    }

    // ── CHAT: conversational planning mode ───────────────────────────────────
    const systemPrompt = `You are an expert goal planner helping a user create a milestone-based goal plan. Unlike timeline goals, this plan has NO fixed end date — it's driven by milestones: major achievements that mark meaningful progress toward the goal.

TODAY: ${today}

STRUCTURE you're planning toward:
- MILESTONES: 3-8 major achievements (e.g. "Launch MVP", "Land First Client", "Complete First Draft")
- TASKS: 3-7 actionable steps per milestone
- SUBTASKS: optional granular actions within tasks

YOUR APPROACH:
1. Ask what the user wants to achieve (if not already clear).
2. Ask what "done" looks like — what are the major achievements they'd celebrate along the way?
3. Ask about their experience level and any constraints (time, money, access).
4. Draft a full milestone plan — all milestones, all tasks.
5. End with: "How does this look?" or "Does this milestone plan work for you?"

RULES:
- NO months, NO weeks, NO deadlines. This is milestone-driven.
- Milestone titles must be achievement-framed ("Ship v1.0", not "Phase 1").
- Tasks must be specific and actionable.
- When user approves (says "yes", "looks good", "save it", etc.), respond with exactly "PLAN_APPROVED" at the start then a warm 2-sentence summary.
- Keep responses warm, specific, and action-oriented.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 4000
    });

    const reply = completion.choices[0].message.content;

    if (reply.includes('PLAN_APPROVED')) {
      return Response.json({ message: reply.replace(/PLAN_APPROVED\s*/i, '').trim(), action: 'plan_approved' });
    }

    return Response.json({ message: reply, action: 'chat' });

  } catch (error) {
    console.error('[milestonePlannerChat] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});