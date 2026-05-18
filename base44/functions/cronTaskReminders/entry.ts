import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CRON_SECRET = Deno.env.get('CRON_SECRET');

const intervalMs = {
  '10min': 10 * 60 * 1000,
  '20min': 20 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1hour': 60 * 60 * 1000,
  '2hours': 2 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'every_other_day': 2 * 24 * 60 * 60 * 1000,
};

function parseWhen(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isInQuietHours(user) {
  if (!user.quiet_hours_enabled || !user.quiet_hours_start || !user.quiet_hours_end) {
    return false;
  }

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const [startHour, startMin] = user.quiet_hours_start.split(':').map(Number);
  const [endHour, endMin] = user.quiet_hours_end.split(':').map(Number);
  
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  if (startTime > endTime) {
    return currentTime >= startTime || currentTime <= endTime;
  }
  
  return currentTime >= startTime && currentTime <= endTime;
}

Deno.serve(async (req) => {
  try {
    console.log('⏰ [TASK REMINDERS] Starting task reminder check...');
    
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    
    let providedSecret = req.headers.get('X-Secret') || url.searchParams.get('secret') || '';
    
    if (!providedSecret) {
      try {
        const body = await req.json();
        providedSecret = body.secret || '';
      } catch (e) {
        // Body not JSON or empty, that's ok
      }
    }
    
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      console.log('❌ [TASK REMINDERS] Unauthorized - invalid secret');
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    const now = Date.now();
    const cutoff = now + 5 * 60 * 1000; // Check tasks due in next 5 minutes

    console.log('👥 [TASK REMINDERS] Getting all users...');
    const allUsers = await base44.asServiceRole.entities.User.list();
    console.log(`📊 [TASK REMINDERS] Found ${allUsers.length} users`);
    console.log(`🕐 [TASK REMINDERS] Current time: ${new Date(now).toISOString()}`);
    console.log(`🕐 [TASK REMINDERS] Cutoff time: ${new Date(cutoff).toISOString()}`);

    let totalScanned = 0;
    let ok = 0, fail = 0, skippedQuietHours = 0;

    for (const user of allUsers) {
      try {
        if (user.notification_settings?.task_reminders === false) {
          console.log(`⏭️  [TASK REMINDERS] Skipping ${user.email} - notifications disabled`);
          continue;
        }

        if (isInQuietHours(user)) {
          console.log(`🌙 [TASK REMINDERS] Skipping ${user.email} - in quiet hours (${user.quiet_hours_start} - ${user.quiet_hours_end})`);
          skippedQuietHours++;
          continue;
        }

        const steps = await base44.asServiceRole.entities.GoalStep.filter({
          created_by: user.email
        });

        const activeSteps = steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
        totalScanned += activeSteps.length;

        console.log(`📋 [TASK REMINDERS] User ${user.email} has ${activeSteps.length} active goal steps`);

        for (const s of activeSteps) {
          if (!s.due_date) continue;
          
          const dueTime = parseWhen(s.due_date);
          const reminderTime = dueTime - (24 * 60 * 60 * 1000); // Remind 24 hours before
          
          console.log(`🔍 [TASK REMINDERS] Step "${s.title}" (ID: ${s.id}): due=${s.due_date}, parsed=${new Date(dueTime).toISOString()}, now=${new Date(now).toISOString()}`);
          
          if (reminderTime && reminderTime <= now && now < dueTime) {
            console.log(`🔔 [TASK REMINDERS] Sending reminder to ${user.email}: "${s.title}" (ID: ${s.id})`);

            const r = await base44.asServiceRole.functions.invoke('notifySend', {
              toUserId: user.email,
              title: 'Goal Step Due Soon 🎯',
              body: s.title || 'You have a goal step due',
              screen: '/Goals',
            });

            if (r?.data?.success) {
              ok++;
              console.log(`✅ [TASK REMINDERS] Reminder sent for step ${s.id}`);
            } else {
              console.error('❌ [TASK REMINDERS] Notification send failed:', r?.data);
              fail++;
            }
          } else if (reminderTime > now) {
            console.log(`⏳ [TASK REMINDERS] Step "${s.title}" (ID: ${s.id}) not yet due: ${new Date(dueTime).toISOString()} (in ${Math.round((dueTime - now) / 60000)} minutes)`);
          }
        }
      } catch (userError) {
        console.error(`❌ [TASK REMINDERS] Error for user ${user.email}:`, userError);
      }
    }

    const result = {
      success: true,
      users: allUsers.length,
      scanned: totalScanned,
      sent: ok,
      errors: fail,
      skippedQuietHours: skippedQuietHours,
      at: new Date().toISOString(),
    };
    
    console.log('✅ [TASK REMINDERS] Complete:', result);
    return Response.json(result);
  } catch (err) {
    console.error('❌ [TASK REMINDERS] Fatal:', err);
    return Response.json({ success: false, error: String(err) }, { status: 500 });
  }
});