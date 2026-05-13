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

    const { messages, mode } = await req.json();

    // mode: 'chat' for conversation, 'extract_plan' to extract structured plan from conversation
    if (mode === 'extract_plan') {
      const conversationText = messages.map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are extracting a structured goal plan from a planning conversation. 
Extract the agreed-upon plan and return it as valid JSON only, no markdown.`
          },
          {
            role: "user",
            content: `Based on this conversation, extract the final agreed goal and plan:

${conversationText}

Return JSON in this exact structure:
{
  "title": "concise goal title",
  "description": "what the user wants to achieve",
  "timeline": "e.g. 5 months",
  "target_date": "YYYY-MM-DD (calculated from today ${new Date().toISOString().split('T')[0]})",
  "category": "one of: learning, health, career, finance, relationships, personal, creative, other",
  "plan_summary": "2-3 sentence summary of the overall plan",
  "steps": [
    {
      "title": "step title",
      "description": "what to do",
      "phase": "e.g. Month 1, Week 1",
      "priority": "low|medium|high|critical",
      "due_date": "YYYY-MM-DD",
      "order_index": 0
    }
  ]
}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);
      return Response.json({ plan });
    }

    // Default: chat mode
    const systemPrompt = `You are an expert goal planner and life coach. Your job is to help users create detailed, actionable, realistic plans to achieve their goals.

When a user shares a goal:
1. Ask clarifying questions to understand their current situation, available time, resources, and constraints
2. Create a detailed, phased plan broken down into specific steps with timeframes
3. Be specific — give actual tasks, not vague suggestions
4. Make it encouraging but realistic
5. Format plans clearly with phases (Month 1, Week 1, etc.)
6. When the user approves the plan (says things like "looks great", "perfect", "let's do it", "save this", "that works"), respond with EXACTLY the phrase "PLAN_APPROVED" at the very start of your message, then summarize the final plan briefly.

Keep responses conversational but structured. Use bullet points and phases when presenting plans.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ]
    });

    const reply = completion.choices[0].message.content;
    return Response.json({ message: reply, approved: reply.startsWith('PLAN_APPROVED') });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});