import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('📊 [WEEKLY RECAP] Starting weekly recap generation...');
        
        if (req.method !== 'POST') {
            return Response.json({ error: 'Method not allowed' }, { status: 405 });
        }

        const url = new URL(req.url);
        const providedSecret = req.headers.get('X-Secret') || url.searchParams.get('secret') || '';
        const CRON_SECRET = Deno.env.get('CRON_SECRET');
        
        if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
            console.log('❌ [WEEKLY RECAP] Unauthorized - invalid secret');
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);
        
        console.log('👥 [WEEKLY RECAP] Getting all users...');
        const allUsers = await base44.asServiceRole.entities.User.list();
        console.log(`📊 [WEEKLY RECAP] Found ${allUsers.length} users`);
        
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        const monday = new Date(today.setDate(diff));
        const weekStart = monday.toISOString().split('T')[0];
        
        console.log(`📅 [WEEKLY RECAP] Generating recaps for week starting ${weekStart}`);

        let recapsSent = 0;

        for (const user of allUsers) {
            try {
                if (user.notification_settings?.daily_summary === false) {
                    console.log(`⏭️  [WEEKLY RECAP] Skipping ${user.email} - notifications disabled`);
                    continue;
                }

                console.log(`📈 [WEEKLY RECAP] Processing ${user.email}...`);

                const steps = await base44.asServiceRole.entities.GoalStep.filter({
                    created_by: user.email
                });

                const weekSteps = steps.filter(s => {
                  if (!s.completed_at) return false;
                  const completedDate = new Date(s.completed_at).toISOString().split('T')[0];
                  return completedDate >= weekStart;
                });

                const totalSteps = weekSteps.length;
                const goals = await base44.asServiceRole.entities.Goal.filter({
                    created_by: user.email,
                    status: 'active'
                });

                console.log(`📊 [WEEKLY RECAP] ${user.email}: ${totalSteps} steps completed, ${goals.length} active goals`);

                const notifyResponse = await base44.asServiceRole.functions.invoke('notifySend', {
                    toUserId: user.email,
                    title: "📊 Your Week in Review",
                    body: `${totalSteps} steps completed • ${goals.length} active goal${goals.length === 1 ? '' : 's'}`,
                    screen: "/Progress"
                });

                if (notifyResponse.data?.success) {
                    recapsSent++;
                    console.log(`✅ [WEEKLY RECAP] Sent successfully to ${user.email}`);
                }
            } catch (userError) {
                console.error(`❌ [WEEKLY RECAP] Error for ${user.email}:`, userError);
            }
        }

        const result = {
            success: true,
            recaps_sent: recapsSent,
            timestamp: new Date().toISOString()
        };
        
        console.log('✅ [WEEKLY RECAP] Complete:', result);
        return Response.json(result);
    } catch (error) {
        console.error('❌ [WEEKLY RECAP] Fatal:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});