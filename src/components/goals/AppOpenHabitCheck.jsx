/**
 * Mounted once at app open. Does two things:
 * 1. Checks if any daily habit steps have a pending check-in that wasn't dismissed.
 * 2. Checks if any goal has unseen AI-generated notifications sent TODAY (same-day popup).
 */
import React, { useEffect, useState } from "react";
import HabitCheckInModal from "./HabitCheckInModal";
import PendingNotificationPopup from "./PendingNotificationPopup";
import { base44 } from "@/api/base44Client";

export default function AppOpenHabitCheck({ user }) {
  const [pendingStep, setPendingStep] = useState(null);
  const [pendingNotif, setPendingNotif] = useState(null); // { notification, goalId }

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    const check = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];

        // 1. Check habit step pending check-in
        const steps = await base44.entities.GoalStep.filter({ is_daily_habit: true });
        const pendingHabit = steps.find(s =>
          s.habit_checkin_pending &&
          s.status !== 'completed' &&
          s.status !== 'skipped' &&
          s.last_habit_checkin_date !== today
        );

        if (!cancelled && pendingHabit) {
          setPendingStep(pendingHabit);
          return; // Show habit check-in first; popup will show after if any
        }

        // 2. Check for same-day unseen AI notifications across all goals
        const goals = await base44.entities.Goal.list();
        for (const goal of goals) {
          if (goal.status !== 'active') continue;
          const pending = (goal.pending_notifications || []).filter(n => {
            if (n.seen) return false;
            // Only show if the notification was created TODAY
            const notifDate = n.created_at ? n.created_at.split('T')[0] : null;
            return notifDate === today;
          });
          if (pending.length > 0) {
            // Show the most recent unseen one
            const latest = pending[pending.length - 1];
            if (!cancelled) {
              setPendingNotif({ notification: latest, goalId: goal.id });
              break;
            }
          }
        }
      } catch (_) { /* silent */ }
    };

    // Small delay so the app UI is ready first
    const timer = setTimeout(check, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user?.email]);

  const handleHabitClose = () => {
    setPendingStep(null);
    // After habit modal closes, check for pending notifications
    const today = new Date().toISOString().split("T")[0];
    base44.entities.Goal.list().then(goals => {
      for (const goal of goals) {
        if (goal.status !== 'active') continue;
        const pending = (goal.pending_notifications || []).filter(n => {
          if (n.seen) return false;
          const notifDate = n.created_at ? n.created_at.split('T')[0] : null;
          return notifDate === today;
        });
        if (pending.length > 0) {
          setPendingNotif({ notification: pending[pending.length - 1], goalId: goal.id });
          break;
        }
      }
    }).catch(() => {});
  };

  if (pendingStep) {
    return (
      <HabitCheckInModal
        step={pendingStep}
        onClose={handleHabitClose}
        onCheckedIn={handleHabitClose}
      />
    );
  }

  if (pendingNotif) {
    return (
      <PendingNotificationPopup
        notification={pendingNotif.notification}
        goalId={pendingNotif.goalId}
        onClose={() => setPendingNotif(null)}
      />
    );
  }

  return null;
}