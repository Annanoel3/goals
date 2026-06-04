import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Calendar, ChevronRight, Target, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function GoalStepNotification() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [data, setData] = useState(null); // { type, goal, step, weekSteps, monthSteps, labels }
  const [theme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const goalId = params.get('goal_id');
    const stepId = params.get('step_id');
    const weekLabel = params.get('week_label');
    const monthLabel = params.get('month_label');

    if (!goalId) { navigate('/Goals'); return; }

    const goals = await base44.entities.Goal.list();
    const goal = goals.find(g => g.id === goalId);
    if (!goal) { navigate('/Goals'); return; }

    const allSteps = await base44.entities.GoalStep.filter({ goal_id: goalId });

    const inAppMessage = params.get('in_app_message');
    const monthTitle = params.get('month_title');

    if (action === 'goal_step' || action === 'goal_step_followup' || action === 'goal_step_due' || action === 'goal_step_tomorrow' || action === 'habit_checkin' || action === 'inactivity_nudge' || action === 'catchup_nudge') {
      const step = stepId ? allSteps.find(s => s.id === stepId) : null;
      const isFollowUp = action === 'goal_step_followup' || action === 'goal_step_tomorrow' || action === 'catchup_nudge';
      const isHabit = action === 'habit_checkin';
      const inAppMsg = params.get('in_app_message');
      setData({ type: 'step', goal, step, isFollowUp, isHabit, inAppMessage: inAppMsg });
    } else if (action === 'week_preview') {
      const weekSteps = allSteps.filter(s =>
        s.phase && weekLabel && s.phase.toLowerCase().includes(weekLabel.toLowerCase().replace(', week', ' week').replace(',', '').trim().toLowerCase())
      ).filter(s => s.status !== 'completed');
      setData({ type: 'week_preview', goal, weekSteps, weekLabel, monthTitle, inAppMessage });
    } else if (action === 'week_summary') {
      setData({ type: 'week_summary', goal, weekLabel, inAppMessage,
        completed: parseInt(params.get('completed') || '0'),
        total: parseInt(params.get('total') || '0'),
        pct: parseInt(params.get('pct') || '0') });
    } else if (action === 'month_preview') {
      const monthNum = monthLabel?.match(/\d+/)?.[0];
      const monthSteps = allSteps.filter(s =>
        s.phase && monthNum && new RegExp(`Month\\s*${monthNum}\\b`, 'i').test(s.phase)
      ).filter(s => s.status !== 'completed');
      setData({ type: 'month_preview', goal, monthSteps, monthLabel, monthTitle, inAppMessage });
    } else if (action === 'month_summary') {
      setData({ type: 'month_summary', goal, monthLabel, inAppMessage,
        completed: parseInt(params.get('completed') || '0'),
        total: parseInt(params.get('total') || '0'),
        pct: parseInt(params.get('pct') || '0') });
    } else if (action === 'goal_week') {
      // legacy
      const weekSteps = allSteps.filter(s =>
        s.phase && weekLabel && s.phase.toLowerCase().includes(weekLabel.toLowerCase().replace(', week', ' week').replace(',', '').trim().toLowerCase())
      ).filter(s => s.status !== 'completed');
      setData({ type: 'week_preview', goal, weekSteps, weekLabel, inAppMessage });
    } else if (action === 'goal_month') {
      // legacy
      const monthNum = monthLabel?.match(/\d+/)?.[0];
      const monthSteps = allSteps.filter(s =>
        s.phase && monthNum && new RegExp(`Month\\s*${monthNum}\\b`, 'i').test(s.phase)
      ).filter(s => s.status !== 'completed');
      setData({ type: 'month_preview', goal, monthSteps, monthLabel, inAppMessage });
    } else {
      navigate(`/goal/${goalId}`);
      return;
    }

    setLoading(false);
  };

  const completeStep = async (step) => {
    setCompleting(true);
    await base44.entities.GoalStep.update(step.id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });
    toast({ title: "Step completed! 🎉" });
    await loadData();
    setCompleting(false);
  };

  const isDark = theme === 'dark';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`min-h-screen p-4 ${isDark ? 'bg-gray-900 text-white' : 'bg-gradient-to-br from-violet-50 to-indigo-50'}`}>
      <div className="max-w-lg mx-auto pt-8">

        {/* Icon + Goal */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-200">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>
            {data.type === 'month_preview' ? 'Month Preview' :
             data.type === 'month_summary' ? 'Month Wrap-Up' :
             data.type === 'week_preview' ? 'Week Preview' :
             data.type === 'week_summary' ? 'Week Wrap-Up' :
             data.isFollowUp ? 'Missed Step' : "Today's Step"}
          </p>
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.goal.title}</h1>
        </div>

        {/* STEP view */}
        {data.type === 'step' && !data.step && (
          <div className={`rounded-2xl p-5 mb-4 text-center ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-base font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-800'}`}>Keep up the momentum! 💪</p>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Check in on your goal and keep making progress.</p>
          </div>
        )}

        {data.type === 'step' && data.step && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            {data.isFollowUp && (
              <div className="mb-3 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 inline-block">
                <span className="text-xs font-semibold text-amber-700">⚠️ Missed yesterday</span>
              </div>
            )}
            {data.inAppMessage && data.isFollowUp && (
              <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{data.inAppMessage}</p>
            )}
            <p className={`text-xs font-semibold mb-1 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.step.phase}</p>
            <h2 className={`text-lg font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.step.title}</h2>
            {data.step.description && (
              <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{data.step.description}</p>
            )}
            {data.step.tips_and_guidance && (
              <div className={`rounded-xl p-3 text-sm ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-violet-50 text-violet-800'}`}>
                <p className="font-semibold text-xs mb-1">💡 Tip</p>
                {data.step.tips_and_guidance}
              </div>
            )}
            {data.step.success_criteria?.length > 0 && (
              <div className="mt-3">
                <p className={`text-xs font-semibold mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Done when:</p>
                <ul className="space-y-1">
                  {data.step.success_criteria.map((c, i) => (
                    <li key={i} className={`text-xs flex items-start gap-1.5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* WEEK PREVIEW view */}
        {data.type === 'week_preview' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-2 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.weekLabel}</p>
            {data.monthTitle && <p className={`text-sm font-semibold mb-3 ${isDark ? 'text-violet-300' : 'text-violet-700'}`}>"{data.monthTitle}"</p>}
            {data.inAppMessage && (
              <p className={`text-sm leading-relaxed mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{data.inAppMessage}</p>
            )}
            <div className="space-y-2">
              {(data.weekSteps || []).map(step => (
                <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-violet-400" />
                  <p className={`text-sm font-medium flex-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{step.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WEEK SUMMARY view */}
        {data.type === 'week_summary' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-2 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.weekLabel}</p>
            <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl ${isDark ? 'bg-gray-700' : 'bg-violet-50'}`}>
              <span className="text-2xl">{data.pct >= 80 ? '🌟' : data.pct >= 50 ? '💪' : '🔄'}</span>
              <div>
                <p className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.completed}/{data.total} steps done</p>
                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{data.pct}% completion this week</p>
              </div>
            </div>
            {data.inAppMessage && (
              <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{data.inAppMessage}</p>
            )}
          </div>
        )}

        {/* MONTH PREVIEW view */}
        {data.type === 'month_preview' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-2 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.monthLabel}</p>
            {data.monthTitle && <p className={`text-base font-bold mb-3 ${isDark ? 'text-violet-300' : 'text-violet-700'}`}>"{data.monthTitle}"</p>}
            {data.inAppMessage && (
              <p className={`text-sm leading-relaxed mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{data.inAppMessage}</p>
            )}
            <p className={`text-xs font-semibold mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{(data.monthSteps || []).length} steps this month</p>
            <div className="space-y-1.5">
              {(data.monthSteps || []).slice(0, 6).map(step => (
                <div key={step.id} className={`flex items-center gap-2 p-2.5 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  <p className={`text-sm flex-1 ${isDark ? 'text-white' : 'text-gray-800'}`}>{step.title}</p>
                  <span className={`text-xs flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{step.phase?.replace(/Month \d+,?\s*/i, '')}</span>
                </div>
              ))}
              {(data.monthSteps || []).length > 6 && (
                <p className={`text-xs text-center pt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>+ {data.monthSteps.length - 6} more steps</p>
              )}
            </div>
          </div>
        )}

        {/* MONTH SUMMARY view */}
        {data.type === 'month_summary' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-2 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.monthLabel}</p>
            <div className={`flex items-center gap-3 mb-4 p-3 rounded-xl ${isDark ? 'bg-gray-700' : 'bg-violet-50'}`}>
              <span className="text-2xl">{data.pct >= 80 ? '🏆' : data.pct >= 50 ? '📈' : '💡'}</span>
              <div>
                <p className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.completed}/{data.total} steps done</p>
                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{data.pct}% completion this month</p>
              </div>
            </div>
            {data.inAppMessage && (
              <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{data.inAppMessage}</p>
            )}
          </div>
        )}

        {/* Mark complete (step only) */}
        {data.type === 'step' && data.step && data.step.status !== 'completed' && (
          <Button
            onClick={() => completeStep(data.step)}
            disabled={completing}
            className="w-full h-12 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-2xl font-semibold mb-3"
          >
            {completing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Mark as Done
          </Button>
        )}

        {/* View full goal */}
        <Button
          variant="outline"
          onClick={() => navigate(`/goal/${data.goal.id}`)}
          className={`w-full h-11 rounded-2xl font-semibold ${isDark ? 'border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800' : ''}`}
        >
          <Target className="w-4 h-4 mr-2" />
          View Full Goal
          <ChevronRight className="w-4 h-4 ml-auto" />
        </Button>

        <button
          onClick={() => navigate('/Goals')}
          className={`w-full mt-3 text-sm text-center ${isDark ? 'text-gray-500' : 'text-gray-400'} hover:opacity-80`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}