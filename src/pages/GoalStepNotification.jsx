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

    if (action === 'goal_step' || action === 'goal_step_followup') {
      const step = allSteps.find(s => s.id === stepId);
      setData({ type: 'step', goal, step, isFollowUp: action === 'goal_step_followup' });
    } else if (action === 'goal_week') {
      const weekSteps = allSteps.filter(s =>
        s.phase && weekLabel && s.phase.toLowerCase().includes(weekLabel.toLowerCase().replace(', week', ' week').replace(',', '').trim().toLowerCase())
      ).filter(s => s.status !== 'completed');
      setData({ type: 'week', goal, weekSteps, weekLabel });
    } else if (action === 'goal_month') {
      const monthNum = monthLabel?.match(/\d+/)?.[0];
      const monthSteps = allSteps.filter(s =>
        s.phase && monthNum && new RegExp(`Month\\s*${monthNum}\\b`, 'i').test(s.phase)
      ).filter(s => s.status !== 'completed');
      setData({ type: 'month', goal, monthSteps, monthLabel });
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
            {data.type === 'month' ? 'Month Preview' : data.type === 'week' ? 'Week Preview' : data.isFollowUp ? 'Missed Step' : "Today's Step"}
          </p>
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.goal.title}</h1>
        </div>

        {/* STEP view */}
        {data.type === 'step' && data.step && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            {data.isFollowUp && (
              <div className="mb-3 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 inline-block">
                <span className="text-xs font-semibold text-amber-700">⚠️ Missed yesterday</span>
              </div>
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

        {/* WEEK view */}
        {data.type === 'week' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.weekLabel}</p>
            <h2 className={`text-base font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>This week's steps</h2>
            <div className="space-y-2">
              {(data.weekSteps || []).map(step => (
                <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${step.status === 'completed' ? 'bg-green-500' : 'bg-violet-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${step.status === 'completed' ? 'line-through opacity-50' : isDark ? 'text-white' : 'text-gray-900'}`}>{step.title}</p>
                    {step.description && <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{step.description.slice(0, 80)}{step.description.length > 80 ? '…' : ''}</p>}
                  </div>
                  {step.status !== 'completed' && (
                    <button onClick={() => completeStep(step)} className="flex-shrink-0 text-green-500 hover:text-green-600">
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
              {(!data.weekSteps || data.weekSteps.length === 0) && (
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>All steps for this week are complete! 🎉</p>
              )}
            </div>
          </div>
        )}

        {/* MONTH view */}
        {data.type === 'month' && (
          <div className={`rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`}>
            <p className={`text-xs font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-violet-500'}`}>{data.monthLabel}</p>
            <h2 className={`text-base font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>Coming up this month</h2>
            <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{(data.monthSteps || []).length} steps ahead</p>
            <div className="space-y-2">
              {(data.monthSteps || []).slice(0, 6).map(step => (
                <div key={step.id} className={`flex items-center gap-2 p-2.5 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-800'}`}>{step.title}</p>
                  <span className={`text-xs ml-auto flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{step.phase?.replace(/Month \d+,?\s*/i, '')}</span>
                </div>
              ))}
              {(data.monthSteps || []).length > 6 && (
                <p className={`text-xs text-center pt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>+ {data.monthSteps.length - 6} more steps</p>
              )}
            </div>
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