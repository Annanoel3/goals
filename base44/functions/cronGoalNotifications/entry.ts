import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

async function sendPush({ externalId, title, body, data, buttons, base44, goalId }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [String(externalId)] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    data: data || {},
    ...(buttons ? { buttons } : {}),
  };
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  const notifId = json?.id || null;

  // Store pending notification on the goal so the in-app popup shows on next app open
  if (notifId && goalId && base44) {
    try {
      await base44.asServiceRole.entities.Goal.update(goalId, {
        pending_notification: {
          title,
          body,
          action: data?.action || null,
          goal_id: goalId,
          step_id: data?.step_id || null,
          nudge_message: data?.nudge_message || null,
          stored_at: new Date().toISOString()
        }
      });
    } catch (_) { /* best effort — don't block the push */ }
  }

  return notifId;
}

function daysAgo(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayUTC = new Date(todayStr + 'T00:00:00Z');
    const dayOfWeek = todayUTC.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = todayUTC.getDate();

    const isMonday = dayOfWeek === 1;
    const isSunday = dayOfWeek === 0;
    const isFirstOfMonth = dayOfMonth === 1;

    // Check if last day of month
    const nextDay = new Date(todayUTC);
    nextDay.setDate(todayUTC.getDate() + 1);
    const isLastOfMonth = nextDay.getDate() === 1;

    // Pre-load all users once — Goal entity stores created_by_id (user ID), not email
    const allUsers = await base44.asServiceRole.entities.User.list();
    const userById = {};
    const userByEmail = {};
    for (const u of allUsers) {
      userById[u.id] = u;
      userByEmail[u.email] = u;
    }

    // Helper: check if current UTC time is within a user's quiet hours.
    // timezone_offset_minutes is stored as -getTimezoneOffset() on the client,
    // so CDT (UTC-5) = +300, EST (UTC-5) = +300, IST (UTC+5:30) = -330, etc.
    // To get local time: UTC + offset_minutes.
    function isInQuietHours(user, timezoneOffsetMinutes) {
      if (!user?.quiet_hours_enabled) return false;
      const start = user.quiet_hours_start || '22:00';
      const end = user.quiet_hours_end || '08:00';
      // Convert UTC now → user's local time using their stored offset
      const offsetMs = (timezoneOffsetMinutes || 0) * 60 * 1000;
      const localNow = new Date(now.getTime() + offsetMs);
      const localMins = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      // Handle overnight range (e.g. 22:00 → 08:00 crosses midnight)
      if (startMins > endMins) {
        return localMins >= startMins || localMins < endMins;
      }
      return localMins >= startMins && localMins < endMins;
    }

    const goals = await base44.asServiceRole.entities.Goal.list();
    const results = {
      month_notifs: 0, week_notifs: 0, step_notifs: 0,
      followup_day1: 0, followup_day3: 0, engagement_notifs: 0,
      week_stats_notifs: 0, month_stats_notifs: 0, inactivity_notifs: 0
    };

    // Group goals by user for inactivity check
    const goalsByUser = {};

    // Track goals already notified this run (1 notification per goal per day)
    const notifiedGoalIds = new Set();

    for (const goal of goals) {
      if (goal.status !== 'active') continue;

      const user = userById[goal.created_by_id];
      if (!user) continue;
      const externalId = user.email;

      // Skip if goal hasn't started yet
      if (goal.start_date && goal.start_date > todayStr) {
        // Still group for inactivity but skip all notifications
        if (!goalsByUser[externalId]) goalsByUser[externalId] = [];
        goalsByUser[externalId].push(goal);
        continue;
      }

      // Skip if currently in user's quiet hours
      if (isInQuietHours(user, goal.timezone_offset_minutes)) {
        if (!goalsByUser[externalId]) goalsByUser[externalId] = [];
        goalsByUser[externalId].push(goal);
        continue;
      }

      // Group for inactivity check later
      if (!goalsByUser[externalId]) goalsByUser[externalId] = [];
      goalsByUser[externalId].push(goal);

      // Get all steps for this goal
      const steps = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: goal.id });
      const pendingSteps = steps.filter(s => s.status !== 'completed' && s.status !== 'skipped');

      // ── 2-WEEK INACTIVITY THROTTLE ──────────────────────────────────────────
      // After 14 days of no activity, suppress ALL notifications except 1 monthly
      const fourteenDaysAgoStr = daysAgo(todayStr, 14);
      const hadRecentActivity = steps.some(s =>
        (s.completed_at && s.completed_at.split('T')[0] >= fourteenDaysAgoStr) ||
        (s.last_habit_checkin_date && s.last_habit_checkin_date >= fourteenDaysAgoStr) ||
        (s.updated_date && s.updated_date.split('T')[0] >= fourteenDaysAgoStr && s.status !== 'pending')
      ) || (goal.updated_date && goal.updated_date.split('T')[0] >= fourteenDaysAgoStr);

      const goalCreatedStr = new Date(goal.created_date).toISOString().split('T')[0];
      const isTwoWeekInactive = goalCreatedStr < fourteenDaysAgoStr && !hadRecentActivity;

      if (isTwoWeekInactive) {
        // Only send 1 smart monthly reminder for inactive goals
        // Skip if already notified today (cross-run dedup)
        if (goal.last_cron_notification_date === todayStr) continue;
        if (isFirstOfMonth) {
          let title = `Thinking about "${goal.title}"? 💙`;
          let body = `It's been a while since you checked in on this goal. No pressure — whenever you're ready, we're here to help you pick back up or adjust your plan.`;

          try {
            const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
              prompt: `Write a short, compassionate push notification for someone who hasn't engaged with their goal "${goal.title}" in over 2 weeks. Goal description: ${goal.description || 'N/A'}. Be warm, non-judgmental, and encouraging. Under 2 sentences. No guilt trips. Suggest they can adjust their plan if needed. Return JSON with "title" (short, 3-6 words, may include one emoji) and "body" (1-2 sentences).`,
              response_json_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  body: { type: "string" }
                }
              }
            });
            if (llmResponse?.title) title = llmResponse.title;
            if (llmResponse?.body) body = llmResponse.body;
          } catch (e) {
            // Fall back to default message
          }

          await sendPush({ base44, goalId: goal.id,
            externalId,
            title,
            body,
            data: { screen: 'GoalStepNotification', action: 'inactivity_monthly', goal_id: goal.id }
          });
          results.month_notifs++;
        }
        continue; // Skip all other notifications for this inactive goal
      }

      // One notification per goal per day (cross-run dedup)
      if (goal.last_cron_notification_date === todayStr || notifiedGoalIds.has(goal.id)) continue;

      // ── 1. MONTH START: first of month → summarize upcoming month ────────────
      if (isFirstOfMonth) {
        const createdDate = new Date(goal.created_date);
        const monthsElapsed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24 * 30.44));
        const currentMonthNum = monthsElapsed + 1;
        const currentMonthLabel = `Month ${currentMonthNum}`;

        const monthSteps = pendingSteps.filter(s =>
          s.phase && new RegExp(`Month\\s*${currentMonthNum}\\b`, 'i').test(s.phase)
        );

        if (monthSteps.length > 0) {
          const stepTitles = monthSteps.slice(0, 3).map(s => `• ${s.title}`).join('\n');
          const more = monthSteps.length > 3 ? `\n+ ${monthSteps.length - 3} more` : '';
          await sendPush({ base44, goalId: goal.id,
            externalId,
            title: `${currentMonthLabel} starts today! 🗓️`,
            body: `Here's what's coming up for "${goal.title}":\n${stepTitles}${more}`,
            data: { screen: 'GoalStepNotification', action: 'goal_month', goal_id: goal.id, month_label: currentMonthLabel }
          });
          results.month_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          continue;
        }
      }

      // ── 2. WEEK START: Monday → summarize upcoming week ───────────────────────
      if (!notifiedGoalIds.has(goal.id) && isMonday) {
        const createdDate = new Date(goal.created_date);
        const weeksElapsed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24 * 7));
        const currentWeekNum = (weeksElapsed % 4) + 1;
        const currentMonthNum2 = Math.floor(weeksElapsed / 4) + 1;
        const currentWeekLabel = `Month ${currentMonthNum2}, Week ${currentWeekNum}`;

        const weekSteps = pendingSteps.filter(s =>
          s.phase &&
          s.phase.toLowerCase().includes(`month ${currentMonthNum2}`) &&
          s.phase.toLowerCase().includes(`week ${currentWeekNum}`)
        );

        if (weekSteps.length > 0) {
          const stepTitles = weekSteps.slice(0, 4).map(s => `• ${s.title}`).join('\n');
          const more = weekSteps.length > 4 ? `\n+ ${weekSteps.length - 4} more` : '';
          await sendPush({ base44, goalId: goal.id,
            externalId,
            title: `New week, new steps! 💪`,
            body: `${currentWeekLabel} of "${goal.title}":\n${stepTitles}${more}`,
            data: { screen: 'GoalStepNotification', action: 'goal_week', goal_id: goal.id, week_label: currentWeekLabel }
          });
          results.week_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          continue;
        }
      }

      // ── 3. MORNING REMINDER: step due today ───────────────────────────────────
      if (!notifiedGoalIds.has(goal.id)) {
      const todaySteps = pendingSteps.filter(s => s.due_date === todayStr);
      for (const step of todaySteps) {
        const alreadySent = step.onesignal_notification_ids?.length > 0;
        if (alreadySent) continue;

        const notifId = await sendPush({ base44, goalId: goal.id,
          externalId,
          title: `Today: ${step.title}`,
          body: step.description
            ? `${step.description.slice(0, 100)}${step.description.length > 100 ? '…' : ''}`
            : `Tap to view details and mark complete.`,
          data: { screen: 'GoalStepNotification', action: 'goal_step', goal_id: goal.id, step_id: step.id },
        });

        if (notifId) {
          const existing = step.onesignal_notification_ids || [];
          await base44.asServiceRole.entities.GoalStep.update(step.id, {
            onesignal_notification_ids: [...existing, notifId]
          });
          results.step_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          break;
        }
      }
      }

      // ── 4. DAY-1 FOLLOW-UP: step due yesterday, still pending ────────────────
      if (!notifiedGoalIds.has(goal.id)) {
      const oneDayAgoStr = daysAgo(todayStr, 1);
      const overdueDayOne = pendingSteps.filter(s => s.due_date === oneDayAgoStr);
      for (const step of overdueDayOne) {
        await sendPush({ base44, goalId: goal.id,
          externalId,
          title: `"${step.title}" is 1 day overdue ⚠️`,
          body: `You missed this step yesterday — want to mark it done or reschedule?`,
          data: { screen: 'GoalStepNotification', action: 'goal_step_followup', goal_id: goal.id, step_id: step.id },
        });
        results.followup_day1++;
        notifiedGoalIds.add(goal.id);
        await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
        break;
      }
      }

      // ── 5. DAY-3 FOLLOW-UP: step due 3 days ago, still pending ───────────────
      if (!notifiedGoalIds.has(goal.id)) {
      const threeDaysAgoStr = daysAgo(todayStr, 3);
      const overdueDay3 = pendingSteps.filter(s => s.due_date === threeDaysAgoStr);
      for (const step of overdueDay3) {
        await sendPush({ base44, goalId: goal.id,
          externalId,
          title: `Still on your list: "${step.title}"`,
          body: `This step has been waiting 3 days. Want to mark it done, adjust it, or move on? Your call.`,
          data: { screen: 'GoalStepNotification', action: 'goal_step_followup', goal_id: goal.id, step_id: step.id }
        });
        results.followup_day3++;
        notifiedGoalIds.add(goal.id);
        await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
        break;
      }
      }

      // ── 6. 2-WEEK ENGAGEMENT CHECK: Monday only ───────────────────────────────
      if (!notifiedGoalIds.has(goal.id) && isMonday) {
        const fourteenDaysAgoStr = daysAgo(todayStr, 14);
        const recentDueSteps = steps.filter(s =>
          s.due_date >= fourteenDaysAgoStr &&
          s.due_date < todayStr
        );
        const completedRecently = recentDueSteps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
        const totalRecentDue = recentDueSteps.length;

        if (totalRecentDue >= 3 && completedRecently / totalRecentDue < 0.3) {
          await sendPush({ base44, goalId: goal.id,
            externalId,
            title: `Let's recalibrate your plan 🔄`,
            body: `You've had a tough couple of weeks on "${goal.title}" — and that's okay. Life happens. Your AI coach has some ideas to get things flowing again. Tap to chat.`,
            data: {
              screen: 'GoalStepNotification',
              action: 'goal_plan_nudge',
              goal_id: goal.id,
              nudge_message: `I noticed you've had a challenging couple of weeks with "${goal.title}" — only ${completedRecently} of ${totalRecentDue} recent steps completed. No judgment at all — life gets busy. I have a few ideas:\n\n1. **Lighten the load** — reduce the number of weekly steps so it feels manageable\n2. **Extend the timeline** — spread things out so you're not racing against deadlines\n3. **Simplify the steps** — break them into smaller, more bite-sized actions\n4. **Swap out steps that aren't working** for ones that better fit your current life\n\nWhat feels right? Or tell me what's been getting in the way — I'll reshape the plan around that.`
            }
          });
          results.engagement_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          continue;
        }
      }

      // ── 7. END-OF-WEEK STATS: Sunday ─────────────────────────────────────────
      if (!notifiedGoalIds.has(goal.id) && isSunday) {
        const weekStart = new Date(todayUTC);
        weekStart.setDate(todayUTC.getDate() - 6);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const dueThisWeek = steps.filter(s => s.due_date >= weekStartStr && s.due_date <= todayStr);
        const completedThisWeek = dueThisWeek.filter(s => s.status === 'completed');
        if (dueThisWeek.length > 0) {
          const pct = Math.round((completedThisWeek.length / dueThisWeek.length) * 100);
          const emoji = pct >= 80 ? '🌟' : pct >= 50 ? '💪' : '🔄';
          const msg = pct >= 80 ? 'Incredible week!' : pct >= 50 ? 'Good progress — keep going!' : 'Next week is a fresh start.';
          await sendPush({ base44, goalId: goal.id,
            externalId,
            title: `Week wrap-up ${emoji}`,
            body: `You finished ${completedThisWeek.length}/${dueThisWeek.length} steps on "${goal.title}" this week (${pct}%). ${msg}`,
            data: { screen: 'GoalStepNotification', action: 'week_stats', goal_id: goal.id, completed: completedThisWeek.length, total: dueThisWeek.length, pct },
          });
          results.week_stats_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          continue;
        }
      }

      // ── 8. END-OF-MONTH STATS ─────────────────────────────────────────────────
      if (!notifiedGoalIds.has(goal.id) && isLastOfMonth) {
        const monthStart = `${todayStr.slice(0, 7)}-01`;
        const dueThisMonth = steps.filter(s => s.due_date >= monthStart && s.due_date <= todayStr);
        const completedThisMonth = dueThisMonth.filter(s => s.status === 'completed');
        if (dueThisMonth.length > 0) {
          const pct = Math.round((completedThisMonth.length / dueThisMonth.length) * 100);
          const emoji = pct >= 80 ? '🏆' : pct >= 50 ? '📈' : '💡';
          const msg = pct >= 80 ? "You crushed it!" : pct >= 50 ? "Solid month — let's build on it!" : "New month, fresh energy — you've got this!";
          await sendPush({ base44, goalId: goal.id,
            externalId,
            title: `Month complete! ${emoji}`,
            body: `This month on "${goal.title}": ${completedThisMonth.length}/${dueThisMonth.length} steps (${pct}%). ${msg}`,
            data: { screen: 'GoalStepNotification', action: 'month_stats', goal_id: goal.id, completed: completedThisMonth.length, total: dueThisMonth.length, pct },
          });
          results.month_stats_notifs++;
          notifiedGoalIds.add(goal.id);
          await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
          continue;
        }
      }
    }

    // ── 9. PER-USER INACTIVITY CHECK (7 days no activity) ─────────────────────
    for (const [externalId, userGoals] of Object.entries(goalsByUser)) {
      const user = userByEmail[externalId];

      // Skip if currently in quiet hours
      const tzOffset = userGoals[0]?.timezone_offset_minutes || 0;
      if (isInQuietHours(user, tzOffset)) continue;

      // Only consider goals that have actually started
      const startedGoals = userGoals.filter(g => !g.start_date || g.start_date <= todayStr);
      if (startedGoals.length === 0) continue;

      const sevenDaysAgo = daysAgo(todayStr, 7);
      const fourteenDaysAgoUser = daysAgo(todayStr, 14);
      // Load all steps for this user's started goals
      let allUserSteps = [];
      for (const g of startedGoals) {
        const s = await base44.asServiceRole.entities.GoalStep.filter({ goal_id: g.id });
        allUserSteps = allUserSteps.concat(s);
      }
      const hadRecentActivity = allUserSteps.some(s =>
        (s.status === 'completed' && s.completed_at && s.completed_at.split('T')[0] >= sevenDaysAgo) ||
        (s.updated_date && s.updated_date.split('T')[0] >= sevenDaysAgo && s.status !== 'pending')
      );
      // If user has been inactive 14+ days, skip 7-day nudge — monthly reminder handles it
      const hadActivityLastTwoWeeks = allUserSteps.some(s =>
        (s.completed_at && s.completed_at.split('T')[0] >= fourteenDaysAgoUser) ||
        (s.last_habit_checkin_date && s.last_habit_checkin_date >= fourteenDaysAgoUser) ||
        (s.updated_date && s.updated_date.split('T')[0] >= fourteenDaysAgoUser && s.status !== 'pending')
      );
      if (!hadRecentActivity && hadActivityLastTwoWeeks && allUserSteps.length > 0) {
        const goal = startedGoals[0];
        // One notification per goal per day (cross-cron dedup)
        if (goal.last_cron_notification_date === todayStr) continue;
        await sendPush({ base44, goalId: goal.id,
          externalId,
          title: `Your goal misses you 💙`,
          body: `It's been a week since any activity on "${goal.title}". Tap to check in.`,
          data: { screen: 'GoalStepNotification', action: 'inactivity_nudge', goal_id: goal.id, can_shift_week: true },
        });
        await base44.asServiceRole.entities.Goal.update(goal.id, { last_cron_notification_date: todayStr });
        results.inactivity_notifs++;
      }
    }

    return Response.json({ success: true, date: todayStr, ...results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});