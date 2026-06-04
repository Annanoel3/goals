/**
 * Shows a dismissible popup for unseen AI-generated notifications
 * (week previews, month previews, summaries, catch-up nudges)
 * that were sent TODAY but the user hasn't tapped yet.
 */
import React from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";

export default function PendingNotificationPopup({ notification, goalId, onClose }) {
  const navigate = useNavigate();
  const isDark = localStorage.getItem('adhd_theme') === 'dark';

  const handleDismiss = async () => {
    try {
      const goal = await base44.entities.Goal.filter({ goal_id: goalId });
      const g = goal?.[0] || (await base44.entities.Goal.list()).find(x => x.id === goalId);
      if (g) {
        const updated = (g.pending_notifications || []).map(n =>
          n.id === notification.id ? { ...n, seen: true } : n
        );
        await base44.entities.Goal.update(g.id, { pending_notifications: updated });
      }
    } catch (_) {}
    onClose();
  };

  const handleViewGoal = async () => {
    await handleDismiss();
    navigate(`/goal/${goalId}`);
  };

  const typeLabel = {
    week_preview: "This Week's Preview",
    week_summary: "Week Wrap-Up",
    month_preview: "Month Preview",
    month_summary: "Month Wrap-Up",
    catchup_nudge: "Catch-Up Check-In",
    missed_habit: "Missed Check-In",
  }[notification.type] || "Goal Update";

  const typeEmoji = {
    week_preview: "📅",
    week_summary: "🏁",
    month_preview: "🚀",
    month_summary: "🌟",
    catchup_nudge: "💪",
    missed_habit: "🔔",
  }[notification.type] || "✨";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className={`w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300 ${
        isDark ? 'bg-gray-900 border border-gray-700' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 pt-5 pb-3 ${
          isDark ? '' : 'bg-gradient-to-r from-violet-50 to-indigo-50'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-violet-400' : 'text-violet-600'}`}>
                {typeEmoji} {typeLabel}
              </p>
              {notification.week_label && (
                <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{notification.week_label}</p>
              )}
              {notification.month_label && !notification.week_label && (
                <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{notification.month_label}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-400'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title */}
        {notification.title && (
          <div className="px-5 pt-1 pb-2">
            <h2 className={`text-base font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{notification.title}</h2>
          </div>
        )}

        {/* Message */}
        <div className="px-5 pb-5">
          <p className={`text-sm leading-relaxed mb-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            {notification.message}
          </p>

          {/* Stats row for summaries */}
          {notification.completed !== undefined && notification.total !== undefined && (
            <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-violet-50'}`}>
              <span className="text-xl">{notification.pct >= 80 ? '🌟' : notification.pct >= 50 ? '💪' : '🔄'}</span>
              <div>
                <p className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {notification.completed}/{notification.total} steps done
                </p>
                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{notification.pct}% completion</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleViewGoal}
              className={`flex-1 rounded-2xl font-semibold text-sm py-2.5 ${
                isDark
                  ? 'bg-violet-600 hover:bg-violet-700 text-white'
                  : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white'
              }`}
            >
              View Goal →
            </Button>
            <Button
              variant="outline"
              onClick={handleDismiss}
              className={`flex-1 rounded-2xl text-sm font-semibold ${
                isDark ? 'border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800' : ''
              }`}
            >
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}