import React from "react";
import { base44 } from "@/api/base44Client";
import { Check } from "lucide-react";

const DAYS = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

// Returns the ISO date string for each day of the current week (Mon–Sun)
function getCurrentWeekDates() {
  const today = new Date();
  // Get Monday of this week
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

export default function HabitWeekTracker({ step, onUpdate }) {
  const weekDates = getCurrentWeekDates();
  const completions = step.habit_completions || [];
  const today = new Date().toISOString().split("T")[0];

  const toggleDay = async (dateStr) => {
    const alreadyDone = completions.includes(dateStr);
    let newCompletions;
    if (alreadyDone) {
      newCompletions = completions.filter(d => d !== dateStr);
    } else {
      newCompletions = [...completions, dateStr];
    }

    const updates = { habit_completions: newCompletions };
    // If toggling today as done, also update check-in fields
    if (dateStr === today && !alreadyDone) {
      updates.habit_checkin_pending = false;
      updates.last_habit_checkin_date = today;
    }

    await base44.entities.GoalStep.update(step.id, updates);
    if (onUpdate) onUpdate();
  };

  return (
    <div className="flex items-center gap-1 px-3 pb-3 pt-1">
      {DAYS.map((label, i) => {
        const dateStr = weekDates[i];
        const isDone = completions.includes(dateStr);
        const isToday = dateStr === today;
        const isFuture = dateStr > today;

        return (
          <button
            key={dateStr}
            onClick={e => { e.stopPropagation(); if (!isFuture) toggleDay(dateStr); }}
            disabled={isFuture}
            className={`flex flex-col items-center gap-0.5 flex-1 rounded-lg py-1.5 transition-all ${
              isFuture
                ? "opacity-30 cursor-default"
                : "cursor-pointer hover:opacity-80 active:scale-95"
            }`}
          >
            <span className={`text-[9px] font-bold uppercase tracking-wide ${
              isToday ? "text-violet-600" : "text-gray-400"
            }`}>
              {label}
            </span>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
              isDone
                ? "bg-green-500 shadow-sm shadow-green-200"
                : isToday
                  ? "border-2 border-violet-400 bg-violet-50"
                  : "border border-gray-200 bg-gray-50"
            }`}>
              {isDone && <Check className="w-3 h-3 text-white stroke-[3]" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}