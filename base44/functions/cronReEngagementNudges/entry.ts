import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const users = await base44.asServiceRole.entities.User.list();

    const results = [];

    for (const user of users) {
      // Get user's goals
      const goals = await base44.asServiceRole.entities.Goal.filter({
        created_by: user.email,
        status: 'active'
      });

      if (goals.length === 0) continue;

      // Check last activity (most recent step completion)
      const allSteps = await base44.asServiceRole.entities.GoalStep.filter({
        created_by: user.email
      });

      const lastActivity = allSteps
        .filter(s => s.status === 'completed' && s.completed_at)
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];

      const lastActivityDate = lastActivity ? new Date(lastActivity.completed_at) : new Date(user.created_date);
      const daysSinceActivity = (now - lastActivityDate) / (1000 * 60 * 60 * 24);

      // Use LLM to determine goal timeline category
      const goalDescriptions = goals.map(g => `${g.title} (${g.timeline || 'unknown duration'})`).join(', ');
      
      const timelineResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Analyze if these goals are short-term (< 3 months) or long-term (3+ months/year+). Respond with only 'short' or 'long'."
          },
          {
            role: "user",
            content: `Goals: ${goalDescriptions}`
          }
        ]
      });

      const goalType = timelineResponse.choices[0].message.content.toLowerCase().includes('long') ? 'long' : 'short';
      const inactivityThreshold = goalType === 'long' ? 14 : 3; // days

      // Check if should send nudge
      if (daysSinceActivity >= inactivityThreshold) {
        // Check if already nudged in this inactivity period
        const lastNudge = user.last_reengagement_nudge ? new Date(user.last_reengagement_nudge) : null;
        const daysSinceLastNudge = lastNudge ? (now - lastNudge) / (1000 * 60 * 60 * 24) : Infinity;

        // Only nudge if we haven't nudged in this inactivity cycle (reset when they re-engage)
        if (!lastNudge || daysSinceLastNudge >= inactivityThreshold) {
          // Send OneSignal notification
          const payload = {
            include_external_user_ids: [user.email],
            headings: { en: "Your goals are waiting! 🎯" },
            contents: { en: "Come back and check on your progress. You've got this!" },
            data: {
              action: 'reengagement_nudge',
              goal_type: goalType
            }
          };

          const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            // Update user's last nudge timestamp
            await base44.asServiceRole.auth.updateUser(user.id, {
              last_reengagement_nudge: now.toISOString()
            });

            results.push({ 
              user_email: user.email, 
              nudged: true, 
              goal_type,
              inactivity_days: Math.round(daysSinceActivity)
            });
          }
        }
      }
    }

    return Response.json({ 
      success: true, 
      processed: results.length,
      results 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});