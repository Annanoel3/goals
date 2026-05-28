import React, { useState } from "react";
import { Bell, Check, X, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function HabitTimePrompt({ step, onScheduled }) {
  const { toast } = useToast();
  const [time, setTime] = useState(step.habit_time || "07:00");
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || step.habit_time) return null;

  const handleSchedule = async () => {
    setLoading(true);
    try {
      const timezoneOffsetMinutes = new Date().getTimezoneOffset();
      const res = await base44.functions.invoke("scheduleHabitNotification", {
        stepId: step.id,
        habitTime: time,
        timezoneOffsetMinutes
      });
      if (res?.data?.warning) {
        toast({ title: "⏰ Habit time saved!", description: `Reminder set for ${formatTime(time)}. Enable push notifications for daily nudges.` });
      } else {
        toast({ title: "🔔 Daily reminder set!", description: `You'll get a nudge every day at ${formatTime(time)}` });
      }
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

  return (
    <div className="mt-2 mx-3 mb-1 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap"
      onClick={e => e.stopPropagation()}>
      <Bell className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
      <span className="text-xs text-violet-700 font-medium flex-1 min-w-0">What time do you do this daily?</span>
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
          onClick={() => setDismissed(true)}
          className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}