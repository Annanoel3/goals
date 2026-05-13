import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CRON_SECRET = Deno.env.get('CRON_SECRET');

Deno.serve(async (req) => {
  try {
    console.log('💪 [SMART MOTIVATION] Starting smart motivation check...');
    
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const providedSecret = req.headers.get('X-Secret') || url.searchParams.get('secret') || '';
    
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      console.log('❌ [SMART MOTIVATION] Unauthorized - invalid secret');
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    console.log('👥 [SMART MOTIVATION] Getting all users...');
    let users;
    try {
      users = await base44.asServiceRole.entities.User.list();
      console.log(`📊 [SMART MOTIVATION] Found ${users.length} users`);
    } catch (userError) {
      console.error('❌ [SMART MOTIVATION] Failed to fetch users:', userError);
      return Response.json({ 
        success: false, 
        error: 'Failed to fetch users',
        details: userError.message 
      }, { status: 500 });
    }
    
    const today = new Date().toISOString().split('T')[0];
    let ok = 0, fail = 0;
    const errors = [];

    for (const user of users) {
      try {
        if (user.last_smart_motivation_date === today) {
          console.log(`⏭️  [SMART MOTIVATION] Skipping ${user.email} - already sent today`);
          continue;
        }

        if (user.notification_settings?.daily_summary === false) {
          console.log(`⏭️  [SMART MOTIVATION] Skipping ${user.email} - notifications disabled`);
          continue;
        }

        console.log(`🔍 [SMART MOTIVATION] Analyzing ${user.email}...`);

        let goals, steps;
        try {
          goals = await base44.asServiceRole.entities.Goal.filter({ created_by: user.email });
          steps = await base44.asServiceRole.entities.GoalStep.filter({ created_by: user.email });
        } catch (dataError) {
          console.error(`❌ [SMART MOTIVATION] Failed to fetch goals/steps for ${user.email}:`, dataError);
          errors.push({ user: user.email, error: 'Failed to fetch goals/steps', details: dataError.message });
          fail++;
          continue;
        }

        const activeGoals = goals.filter(g => g.status === 'active');
        const activeSteps = steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
        const completedToday = steps.filter(s => {
          if (s.status !== 'completed' || !s.completed_at) return false;
          const completedDate = new Date(s.completed_at).toISOString().split('T')[0];
          return completedDate === today;
        });

        console.log(`📋 [SMART MOTIVATION] ${user.email}: ${activeGoals.length} active goals, ${activeSteps.length} active steps, ${completedToday.length} completed today`);

        if (activeGoals.length === 0 && activeSteps.length === 0 && completedToday.length === 0) {
          console.log(`⏭️  [SMART MOTIVATION] Skipping ${user.email} - no activity`);
          continue;
        }

        let message = '';
        if (completedToday.length > 0) {
          message = `Great work today! You completed ${completedToday.length} step${completedToday.length === 1 ? '' : 's'} toward your goals.`;
        } else if (activeSteps.length > 0) {
          message = `You have ${activeSteps.length} step${activeSteps.length === 1 ? '' : 's'} ready across ${activeGoals.length} goal${activeGoals.length === 1 ? '' : 's'}. Let's go!`;
        } else if (activeGoals.length > 0) {
          message = `You're working on ${activeGoals.length} goal${activeGoals.length === 1 ? '' : 's'}. Keep the momentum going!`;
        }

        if (message) {
          console.log(`🔔 [SMART MOTIVATION] Sending to ${user.email}: "${message}"`);
          
          try {
            const r = await base44.asServiceRole.functions.invoke('notifySend', {
              toUserId: user.email,
              title: '💪 Your Daily Check-In',
              body: message,
              screen: '/Home',
            });

            console.log(`[SMART MOTIVATION] notifySend response:`, r?.data);

            if (r?.data?.success) {
              await base44.asServiceRole.entities.User.update(user.id, {
                last_smart_motivation_date: today,
              });
              ok++;
              console.log('✅ [SMART MOTIVATION] Sent successfully');
            } else {
              console.error('❌ [SMART MOTIVATION] Failed:', r?.data);
              errors.push({ user: user.email, error: 'notifySend failed', details: r?.data });
              fail++;
            }
          } catch (notifyError) {
            console.error(`❌ [SMART MOTIVATION] Error calling notifySend for ${user.email}:`, notifyError);
            errors.push({ user: user.email, error: 'notifySend exception', details: notifyError.message });
            fail++;
          }
        }
      } catch (userLoopError) {
        console.error(`❌ [SMART MOTIVATION] Error processing user ${user.email}:`, userLoopError);
        errors.push({ user: user.email, error: 'User loop exception', details: userLoopError.message });
        fail++;
      }
    }

    const result = {
      success: true,
      checked: users.length,
      sent: ok,
      errors: fail,
      errorDetails: errors,
      at: new Date().toISOString(),
    };
    
    console.log('✅ [SMART MOTIVATION] Complete:', result);
    return Response.json(result);
  } catch (err) {
    console.error('❌ [SMART MOTIVATION] Fatal:', err);
    return Response.json({ 
      success: false, 
      error: String(err),
      stack: err.stack 
    }, { status: 500 });
  }
});