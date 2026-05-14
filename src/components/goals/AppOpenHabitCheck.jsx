/**
 * Mounted once at app open. Checks if any daily habit steps have a pending
 * check-in that wasn't dismissed from the notification. Shows the modal if so.
 */
import React, { useEffect, useState } from "react";
import HabitCheckInModal from "./HabitCheckInModal";
import { base44 } from "@/api/base44Client";

export default function AppOpenHabitCheck({ user }) {
  const [pendingStep, setPendingStep] = useState(null);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    const check = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        // Find habit steps that are pending check-in and haven't been checked in today
        const steps = await base44.entities.GoalStep.filter({ is_daily_habit: true });
        const pending = steps.find(s =>
          s.habit_checkin_pending &&
          s.status !== 'completed' &&
          s.status !== 'skipped' &&
          s.last_habit_checkin_date !== today
        );
        if (!cancelled && pending) {
          setPendingStep(pending);
        }
      } catch (_) { /* silent */ }
    };

    // Small delay so the app UI is ready first
    const timer = setTimeout(check, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user?.email]);

  if (!pendingStep) return null;

  return (
    <HabitCheckInModal
      step={pendingStep}
      onClose={() => setPendingStep(null)}
      onCheckedIn={() => setPendingStep(null)}
    />
  );
}