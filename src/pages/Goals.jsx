import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, Plus, CheckCircle2, Clock, Pause, ChevronRight, Loader2, Calendar, Bell, X } from "lucide-react";

const CATEGORY_COLORS = {
  learning: "bg-blue-100 text-blue-700",
  health: "bg-green-100 text-green-700",
  career: "bg-orange-100 text-orange-700",
  finance: "bg-yellow-100 text-yellow-700",
  relationships: "bg-pink-100 text-pink-700",
  personal: "bg-purple-100 text-purple-700",
  creative: "bg-rose-100 text-rose-700",
  other: "bg-gray-100 text-gray-700",
};

const STATUS_CONFIG = {
  active: { icon: Clock, label: "Active", color: "text-blue-600" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-green-600" },
  paused: { icon: Pause, label: "Paused", color: "text-gray-500" },
};

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("active");
  const [inProgress, setInProgress] = useState(false);
  const [pendingNotif, setPendingNotif] = useState(null); // { goalId, notif }
  const navigate = useNavigate();
  const theme = localStorage.getItem('adhd_theme') || 'minimalist';
  const isDark = theme === 'dark';

  useEffect(() => { loadData(); }, []);
  
  useEffect(() => {
    // Check if there's an in-progress goal session
    const saved = localStorage.getItem('plannerInProgress');
    setInProgress(!!saved);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [goalsData, stepsData] = await Promise.all([
        base44.entities.Goal.list('-created_date'),
        base44.entities.GoalStep.list('-order_index')
      ]);
      setGoals(goalsData);
      setSteps(stepsData);
      // Check for any unseen pending notifications across all goals
      for (const goal of goalsData) {
        const pending = (goal.pending_notifications || []).filter(n => !n.seen);
        if (pending.length > 0) {
          setPendingNotif({ goalId: goal.id, notif: pending[0] });
          break; // show one at a time
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const dismissPendingNotif = async () => {
    if (!pendingNotif) return;
    const goal = goals.find(g => g.id === pendingNotif.goalId);
    if (!goal) { setPendingNotif(null); return; }
    const updated = (goal.pending_notifications || []).map(n =>
      n.id === pendingNotif.notif.id ? { ...n, seen: true } : n
    );
    await base44.entities.Goal.update(pendingNotif.goalId, { pending_notifications: updated });
    setPendingNotif(null);
  };

  const openPendingNotif = async () => {
    if (!pendingNotif) return;
    const goal = goals.find(g => g.id === pendingNotif.goalId);
    if (!goal) return;
    // Mark as seen
    const updated = (goal.pending_notifications || []).map(n =>
      n.id === pendingNotif.notif.id ? { ...n, seen: true } : n
    );
    await base44.entities.Goal.update(pendingNotif.goalId, { pending_notifications: updated });
    setPendingNotif(null);
    // Navigate to GoalStepNotification with the stored message data
    const n = pendingNotif.notif;
    const params = new URLSearchParams({
      action: n.type,
      goal_id: pendingNotif.goalId,
      in_app_message: n.message || '',
      ...(n.week_label ? { week_label: n.week_label } : {}),
      ...(n.month_label ? { month_label: n.month_label } : {}),
    });
    navigate(`/GoalStepNotification?${params.toString()}`);
  };

  const getGoalProgress = (goalId) => {
    const goalSteps = steps.filter(s => s.goal_id === goalId);
    if (goalSteps.length === 0) return 0;
    const completed = goalSteps.filter(s => s.status === 'completed').length;
    return Math.round((completed / goalSteps.length) * 100);
  };

  const getStepCount = (goalId) => steps.filter(s => s.goal_id === goalId).length;

  const filteredGoals = goals.filter(g => g.status === activeTab);

  return (
    <div className="min-h-screen pb-32 px-4 sm:px-6 md:px-8 pt-6">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>My Goals</h1>
            <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{goals.filter(g => g.status === 'active').length} active goals</p>
          </div>
          <Button
            onClick={() => navigate("/Planner")}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-2xl shadow-md shadow-violet-100 font-semibold text-sm h-10 px-5"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            New Goal
          </Button>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 p-1 rounded-xl mb-8 ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
          {["active", "completed", "paused"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-sm font-medium py-2 rounded-lg capitalize transition-all ${
                activeTab === tab
                  ? isDark ? 'bg-gray-700 text-gray-100 shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                  : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              <span className={`ml-1.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                ({goals.filter(g => g.status === tab).length})
              </span>
            </button>
          ))}
        </div>

        {/* Pending Notification Banner */}
        {pendingNotif && activeTab === "active" && (
          <div className={`mb-4 rounded-2xl border overflow-hidden ${isDark ? 'bg-violet-900/30 border-violet-700' : 'bg-violet-50 border-violet-200'}`}>
            <button onClick={openPendingNotif} className="w-full text-left p-4">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-violet-700' : 'bg-violet-200'}`}>
                  <Bell className={`w-4 h-4 ${isDark ? 'text-violet-200' : 'text-violet-700'}`} />
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${isDark ? 'text-violet-400' : 'text-violet-600'}`}>
                    {pendingNotif.notif.type === 'week_preview' ? 'Week Preview' :
                     pendingNotif.notif.type === 'week_summary' ? 'Week Wrap-Up' :
                     pendingNotif.notif.type === 'month_preview' ? 'Month Preview' :
                     'Month Wrap-Up'}
                  </p>
                  <p className={`text-sm font-semibold leading-snug ${isDark ? 'text-white' : 'text-gray-900'}`}>{pendingNotif.notif.title}</p>
                  <p className={`text-xs mt-1 line-clamp-2 ${isDark ? 'text-violet-300' : 'text-violet-700'}`}>{pendingNotif.notif.message}</p>
                  <p className={`text-xs mt-1.5 font-medium ${isDark ? 'text-violet-400' : 'text-violet-600'}`}>Tap to read →</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); dismissPendingNotif(); }} className={`flex-shrink-0 p-1 rounded-lg ${isDark ? 'hover:bg-violet-800 text-violet-400' : 'hover:bg-violet-100 text-violet-400'}`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </button>
          </div>
        )}

        {/* In-Progress Indicator */}
        {inProgress && activeTab === "active" && (
          <div className={`mb-6 p-4 rounded-2xl border flex items-start gap-3 ${isDark ? 'bg-blue-900/30 border-blue-700 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            <Loader2 className="w-4 h-4 animate-spin mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Goal in progress...</p>
              <p className={`text-xs mt-1 ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>A goal is being created. Go to Planner to continue or come back to see it appear here.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => navigate("/Planner")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${isDark ? 'hover:bg-blue-800 text-blue-300' : 'hover:bg-blue-100 text-blue-600'}`}
              >
                Continue
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('plannerInProgress');
                  setInProgress(false);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${isDark ? 'hover:bg-blue-800 text-blue-300' : 'hover:bg-blue-100 text-blue-600'}`}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Goals List */}
         {loading ? (
           <div className="flex justify-center py-16">
             <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
           </div>
         ) : filteredGoals.length === 0 ? (
           <EmptyState activeTab={activeTab} onNewGoal={() => navigate("/Planner")} isDark={isDark} />
         ) : (
          <div className="space-y-3">
             {filteredGoals.map(goal => (
               <GoalCard
                 key={goal.id}
                 goal={goal}
                 progress={getGoalProgress(goal.id)}
                 stepCount={getStepCount(goal.id)}
                 onClick={() => navigate(`/goal/${goal.id}`)}
                 isDark={isDark}
               />
             ))}
           </div>
         )}
        </div>
        </div>
  );
}

function GoalCard({ goal, progress, stepCount, onClick, isDark }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl p-4 sm:p-5 text-left shadow-sm transition-all group border ${
        isDark
          ? 'bg-gray-800 border-gray-700 hover:border-violet-500'
          : 'bg-white border-gray-100 hover:shadow-md hover:border-violet-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
              isDark
                ? 'bg-gray-700 text-gray-300'
                : CATEGORY_COLORS[goal.category] || CATEGORY_COLORS.other
            }`}>
              {goal.category}
            </span>
            {goal.timeline && (
              <span className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <Calendar className="w-3 h-3" />
                {goal.timeline}
              </span>
            )}
          </div>
          <h3 className={`font-semibold text-base leading-snug mb-1 truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{goal.title}</h3>
          {goal.plan_summary && (
            <p className={`text-sm line-clamp-2 leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{goal.plan_summary}</p>
          )}
        </div>
        <ChevronRight className={`w-5 h-5 flex-shrink-0 mt-1 transition-colors group-hover:text-violet-400 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} />
      </div>

      {stepCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{stepCount} steps</span>
            <span className="text-xs font-semibold text-violet-400">{progress}%</span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

function EmptyState({ activeTab, onNewGoal, isDark }) {
  if (activeTab === "active") {
    return (
      <div className="text-center py-16 px-6">
        <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4 ${isDark ? 'bg-gray-800' : 'bg-violet-50'}`}>
          <Target className="w-8 h-8 text-violet-400" />
        </div>
        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>No active goals yet</h3>
        <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Use the Planner to create your first AI-powered goal plan.</p>
        <Button onClick={onNewGoal} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl">
          <Plus className="w-4 h-4 mr-2" /> Create a Goal
        </Button>
      </div>
    );
  }
  return (
    <div className="text-center py-16 px-6">
      <p className="text-gray-400 text-sm">No {activeTab} goals.</p>
    </div>
  );
}