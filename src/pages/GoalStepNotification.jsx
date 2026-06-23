import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Calendar, ChevronRight, Target, Sparkles, TrendingUp, MessageCircle, AlertCircle, BarChart2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function GoalStepNotification() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [shifting, setShifting] = useState(false);
  const [data, setData] = useState(null);
  const [theme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const goalId = params.get('goal_id');
    const stepId = params.get('step_id');
    const weekLabel = params.get('week_label');
    const monthLabel = params.get('month_label');
    const nudgeMessage = params.get('nudge_message');
    // Stats passed directly from notification data
    const completed = params.get('completed');
    const total = params.get('total');
    const pct = params.get('pct');

    if (!goalId) { navigate('/Goals'); return; }

    const goals = await base44.entities.Goal.list();
    const goal = goals.find(g => g.id === goalId);
    if (!goal) { navigate('/Goals'); return; }

    const allSteps = await base44.entities.GoalStep.filter({ goal_id: goalId });

    if (action === 'inactivity_nudge') {
      const nextPending = allSteps.find(s => s.status === 'pending');
      setData({ type: 'inactivity', goal, nextPending });

    } else if (action === 'goal_plan_nudge') {
      setData({ type: 'plan_nudge', goal, nudgeMessage });

    } else if (action === 'week_stats') {
      setData({ type: 'week_stats', goal, completed: Number(completed), total: Number(total), pct: Number(pct) });

    } else if (action === 'month_stats') {
      setData({ type: 'month_stats', goal, completed: Number(completed), total: Number(total), pct: Number(pct) });

    } else if (action === 'goal_step' || action === 'goal_step_followup' || action === 'goal_step_due' || action === 'goal_step_tomorrow' || action === 'habit_checkin') {
      const step = stepId ? allSteps.find(s => s.id === stepId) : null;
      const isFollowUp = action === 'goal_step_followup' || action === 'goal_step_tomorrow';
      setData({ type: 'step', goal, step, isFollowUp });

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

  const shiftPlanOneWeek = async (goalId) => {
    setShifting(true);
    try {
      const goals = await base44.entities.Goal.list();
      const goal = goals.find(g => g.id === goalId);
      if (goal) {
        const addWeek = (dateStr) => {
          if (!dateStr) return dateStr;
          const d = new Date(dateStr + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() + 7);
          return d.toISOString().split('T')[0];
        };
        await base44.entities.Goal.update(goalId, {
          start_date: addWeek(goal.start_date),
          target_date: addWeek(goal.target_date),
        });
      }
      toast({ title: "Plan shifted one week! 📅" });
      navigate(`/goal/${goalId}`);
    } catch {
      toast({ title: "Couldn't shift plan", variant: "destructive" });
    } finally {
      setShifting(false);
    }
  };

  const isDark = theme === 'dark';

  const card = `rounded-2xl p-5 mb-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-violet-100 shadow-sm'}`;
  const heading = `text-lg font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`;
  const subtext = `text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`;
  const labelText = `text-xs font-semibold uppercase tracking-wide mb-1 ${isDark ? 'text-gray-400' : 'text-violet-500'}`;
  const primaryBtn = `w-full h-12 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-2xl font-semibold mb-3`;
  const outlineBtn = `w-full h-11 rounded-2xl font-semibold mb-3 ${isDark ? 'border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800' : ''}`;
  const dismissBtn = `w-full mt-1 text-sm text-center ${isDark ? 'text-gray-500' : 'text-gray-400'} hover:opacity-80`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
      </div>
    );
  }

  if (!data) return null;

  // Header label per type
  const headerLabel = {
    inactivity: 'Check In',
    plan_nudge: 'AI Coach',
    week_stats: 'Week Recap',
    month_stats: 'Month Recap',
    week: 'Week Preview',
    month: 'Month Preview',
    step: data.isFollowUp ? 'Missed Step' : "Today's Step",
  }[data.type] || "Goal Update";

  return (
    <div className={`min-h-screen p-4 ${isDark ? 'bg-gray-900 text-white' : 'bg-gradient-to-br from-violet-50 to-indigo-50'}`}>
      <div className="max-w-lg mx-auto pt-8">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-200">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <p className={labelText}>{headerLabel}</p>
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.goal.title}</h1>
        </div>

        {/* ── INACTIVITY ── */}
        {data.type === 'inactivity' && (
          <>
            <div className={card}>
              <p className={heading}>It's been a week 💙</p>
              <p className={subtext}>
                No activity in the last 7 days.
                {data.nextPending ? ` "${data.nextPending.title}" is still waiting for you.` : ''}
              </p>
            </div>
            <Button onClick={() => shiftPlanOneWeek(data.goal.id)} disabled={shifting} className={primaryBtn}>
              {shifting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
              Shift plan forward 1 week
            </Button>
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Goal & Resume
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── PLAN NUDGE (AI Coach) ── */}
        {data.type === 'plan_nudge' && (
          <>
            <div className={card}>
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>Your plan may need a tune-up</p>
              </div>
              <p className={subtext}>
                You've had a challenging stretch recently — and that's completely okay. Your AI coach has some ideas to help you get back on track.
              </p>
            </div>
            <Button
              onClick={() => navigate(`/Planner?goal_id=${data.goal.id}&nudge=1`)}
              className={primaryBtn}
            >
              <MessageCircle className="w-4 h-4 mr-2" /> Chat with AI Coach
            </Button>
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Goal
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── WEEK STATS ── */}
        {data.type === 'week_stats' && (
          <>
            <div className={card}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className={`w-5 h-5 ${isDark ? 'text-violet-400' : 'text-violet-500'}`} />
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>This week's results</p>
              </div>
              <div className="flex items-end gap-2 mb-3">
                <span className={`text-4xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.pct}%</span>
                <span className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>completion rate</span>
              </div>
              <div className={`w-full rounded-full h-2 mb-3 ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <div
                  className={`h-2 rounded-full ${data.pct >= 80 ? 'bg-green-500' : data.pct >= 50 ? 'bg-violet-500' : 'bg-amber-400'}`}
                  style={{ width: `${data.pct}%` }}
                />
              </div>
              <p className={subtext}>
                {data.completed} of {data.total} steps completed.{' '}
                {data.pct >= 80 ? 'Incredible week! 🌟' : data.pct >= 50 ? 'Good progress — keep going! 💪' : 'Next week is a fresh start. 🔄'}
              </p>
            </div>
            <Button onClick={() => navigate(`/goal/${data.goal.id}`)} className={primaryBtn}>
              <TrendingUp className="w-4 h-4 mr-2" /> View My Progress
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── MONTH STATS ── */}
        {data.type === 'month_stats' && (
          <>
            <div className={card}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className={`w-5 h-5 ${isDark ? 'text-violet-400' : 'text-violet-500'}`} />
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>Month complete!</p>
              </div>
              <div className="flex items-end gap-2 mb-3">
                <span className={`text-4xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{data.pct}%</span>
                <span className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>this month</span>
              </div>
              <div className={`w-full rounded-full h-2 mb-3 ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <div
                  className={`h-2 rounded-full ${data.pct >= 80 ? 'bg-green-500' : data.pct >= 50 ? 'bg-violet-500' : 'bg-amber-400'}`}
                  style={{ width: `${data.pct}%` }}
                />
              </div>
              <p className={subtext}>
                {data.completed} of {data.total} steps completed.{' '}
                {data.pct >= 80 ? "You crushed it! 🏆" : data.pct >= 50 ? "Solid month — let's build on it! 📈" : "New month, fresh energy — you've got this! 💡"}
              </p>
            </div>
            <Button onClick={() => navigate(`/goal/${data.goal.id}`)} className={primaryBtn}>
              <TrendingUp className="w-4 h-4 mr-2" /> See Full Progress
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── STEP (today's / follow-up / no step) ── */}
        {data.type === 'step' && !data.step && (
          <>
            <div className={`${card} text-center`}>
              <p className={`text-base font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-800'}`}>Keep up the momentum! 💪</p>
              <p className={subtext}>Check in on your goal and keep making progress.</p>
            </div>
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Goal <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {data.type === 'step' && data.step && (
          <>
            <div className={card}>
              {data.isFollowUp && (
                <div className="mb-3 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 inline-block">
                  <span className="text-xs font-semibold text-amber-700">⚠️ Missed step</span>
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
            {data.step.status !== 'completed' && (
              <Button onClick={() => completeStep(data.step)} disabled={completing} className={primaryBtn}>
                {completing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Mark as Done
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Full Goal <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── WEEK PREVIEW ── */}
        {data.type === 'week' && (
          <>
            <div className={card}>
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
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Full Goal <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

        {/* ── MONTH PREVIEW ── */}
        {data.type === 'month' && (
          <>
            <div className={card}>
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
            <Button variant="outline" onClick={() => navigate(`/goal/${data.goal.id}`)} className={outlineBtn}>
              <Target className="w-4 h-4 mr-2" /> View Full Goal <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
            <button onClick={() => navigate('/Goals')} className={dismissBtn}>Dismiss</button>
          </>
        )}

      </div>
    </div>
  );
}