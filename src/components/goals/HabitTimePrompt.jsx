import React, { useState } from "react";
import { Bell, Check, X, Clock, Pencil } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function HabitTimePrompt({ step, onScheduled }) {
  const { toast } = useToast();
  const [time, setTime] = useState(step.habit_time || "07:00");
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);

  // If no habit_time yet and not dismissed, show the "set time" prompt
  // If habit_time is set, show a small edit button (unless dismissed or currently editing)
  const hasTime = !!step.habit_time;

  if (dismissed) return null;

  const handleSchedule = async () => {
    setLoading(true);
    try {
      const timezoneOffsetMinutes = new Date().getTimezoneOffset();
      await base44.functions.invoke("scheduleHabitNotification", {
        stepId: step.id,
        habitTime: time,
        timezoneOffsetMinutes
      });
      toast({ title: "🔔 Daily reminder updated!", description: `You'll get a nudge every day at ${formatTime(time)}` });
      setEditing(false);
      if (onScheduled) onScheduled();
    } catch (err) {
      toast({ title: "Couldn't set reminder", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  function formatTime(t) {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
  }

  // Already has a time set and not currently editing — show compact edit pill
  if (hasTime && !editing) {
    return (
      <div className="mt-1 mx-3 mb-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 transition-colors"
        >
          <Clock className="w-3 h-3" />
          <span>{formatTime(step.habit_time)}</span>
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  }

  // No time yet (or editing) — show full prompt
  return (
    <div className="mt-2 mx-3 mb-1 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap"
      onClick={e => e.stopPropagation()}>
      <Bell className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
      <span className="text-xs text-violet-700 font-medium flex-1 min-w-0">
        {hasTime ? `Change reminder time` : `What time do you do this daily?`}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 bg-white border border-violet-200 rounded-lg px-2 py-1">
          <Clock className="w-3 h-3 text-violet-400" />
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="text-xs text-gray-700 bg-transparent outline-none w-20"
          />
        </div>
        <button
          onClick={handleSchedule}
          disabled={loading}
          className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={() => hasTime ? setEditing(false) : setDismissed(true)}
          className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}