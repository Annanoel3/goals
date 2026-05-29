import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { weekNumber } = body;

    // Fetch a random funny celebration GIF based on week
    const searchQueries = {
      1: 'funny celebration dance gif',
      2: 'hilarious success gif',
      3: 'silly party gif'
    };

    const query = searchQueries[weekNumber] || 'funny celebration gif';
    
    // Use InvokeLLM with web context to find a random celebration GIF URL
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Find a random funny celebration or success GIF URL for week ${weekNumber} completion. Return ONLY the direct GIF URL, nothing else. Search for: ${query}`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          gif_url: { type: "string" }
        }
      }
    });

    return Response.json({ 
      gif_url: response.gif_url || null,
      week: weekNumber 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});