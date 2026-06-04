import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import OpenAI from "npm:openai";

Deno.serve(async (req) => {
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { conversation_text, title, description } = body;

    const input = `Title: ${title || ''}
Description: ${description || ''}
Conversation:
${conversation_text || ''}`;

    const classification = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a goal type classifier. Analyze the goal and return ONLY valid JSON.

Classify the goal into one of these types:
- "reading": Reading books, novels, stories, articles, learning through text
- "fitness": Exercise, workouts, strength training, cardio, athletic performance
- "language": Learning a new language, speaking practice, fluency
- "creative": Art, music, writing, dance, design, creative expression
- "learning": Coding, design, technical skills, academic subjects (not language)
- "health": Nutrition, sleep, mental health, wellness habits, meditation, stress management
- "career": Job search, professional development, certifications, work-related skills
- "finance": Saving, investing, budgeting, paying off debt, earning money
- "personal": Personal growth, confidence, boundaries, mindset, relationships
- "project": Complete a project, build something, creative project outcomes
- "other": None of above

Return ONLY this JSON (no markdown, no extra text):
{
  "goal_type": "reading|fitness|language|creative|learning|health|career|finance|personal|project|other",
  "is_daily_habit": true|false,
  "notification_frequency": "daily|weekdays|weekly|3x_per_week|2x_per_week|once_per_week",
  "requires_daily_breakdown": true|false,
  "requires_chapter_lookup": true|false,
  "reasoning": "brief explanation"
}`
        },
        {
          role: "user",
          content: input
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(classification.choices[0].message.content);
    
    console.log(`[classifyGoalType] Classified as: ${result.goal_type}, is_daily_habit=${result.is_daily_habit}, notification_frequency=${result.notification_frequency}`);
    
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});