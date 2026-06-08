import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Calendar, CheckCircle2, Clock, AlertCircle, Plus, Trash2, ChevronDown, ChevronUp, Upload, X, History } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import StepDetailsModal from "@/components/goals/StepDetailsModal";
import HabitTimePrompt from "@/components/goals/HabitTimePrompt";
import HabitCheckInModal from "@/components/goals/HabitCheckInModal";
import HabitWeekTracker from "@/components/goals/HabitWeekTracker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import MonthCelebrationModal from "@/components/goals/MonthCelebrationModal";
import WeekCelebrationModal from "@/components/goals/WeekCelebrationModal";

function StepRow({ step, onOpen, onToggle, onCheckIn, onUpdate }) {
  const isHabit = step.is_daily_habit || /affirm|affirmation|habit|meditat|journal|morning|exercise|daily|routine/i.test(step.title);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(step.title);
  const handleSave = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === step.title) { setEditing(false); return; }
    // Cancel ALL existing OneSignal notifications so they get recreated with the new title
    const notifIds = step.onesignal_notification_ids || [];
    for (const nid of notifIds) {
      try { await base44.functions.invoke('cancelScheduled', { notificationId: nid }); } catch(e) {}
    }
    await base44.entities.GoalStep.update(step.id, {
      title: trimmed,
      onesignal_notification_ids: []
    });
    // Reschedule notifications for this step's goal with the updated title
    try { await base44.functions.invoke('scheduleGoalNotifications', { goal_id: step.goal_id }); } catch(e) {}
    setEditing(false);
    onUpdate();
  };
  return (
    <div className={`rounded-lg border overflow-hidden ${step.status === 'completed' ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100 hover:border-violet-300'}`}>
      <div className="flex items-start gap-3 p-3">
        <div className="flex-shrink-0 mt-0.5" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <Checkbox checked={step.status === 'completed'} onCheckedChange={() => onToggle()} />
        </div>
        <button onClick={onOpen} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                <input
                  autoFocus
                  className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 focus:outline-none"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setEditText(step.title); } }}
                />
                <button onClick={e => { e.stopPropagation(); handleSave(); }} className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded hover:bg-blue-600">Save</button>
                <button onClick={e => { e.stopPropagation(); setEditing(false); setEditText(step.title); }} className="text-xs text-gray-400 px-1 hover:text-gray-600">✕</button>
              </div>
            ) : (
              <h4
                className={`font-medium text-sm cursor-pointer ${step.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}
                onClick={e => { e.stopPropagation(); setEditing(true); }}
                title="Tap to edit"
              >
                {step.title}
              </h4>
            )}
            {step.is_daily_habit && step.habit_time && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">🔔 {step.habit_time}</span>
            )}
          </div>
          {step.description && (
            <p className={`text-xs mt-1 line-clamp-2 ${step.status === 'completed' ? 'text-gray-400' : 'text-gray-500'}`}>{step.description}</p>
          )}
        </button>
      </div>
      {isHabit && step.status !== 'completed' && <HabitWeekTracker step={step} onUpdate={onUpdate} />}
      {isHabit && step.habit_checkin_pending && step.status !== 'completed' && (
        <button onClick={e => { e.stopPropagation(); onCheckIn(); }} className="w-full text-center py-2 text-xs font-semibold text-violet-700 bg-violet-50 border-t border-violet-100 hover:bg-violet-100 transition-colors">
          ✅ Did you do it today? Tap to check in
        </button>
      )}
    </div>
  );
}

export default function GoalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [goal, setGoal] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState({});
  const [selectedStep, setSelectedStep] = useState(null);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [habitCheckInStep, setHabitCheckInStep] = useState(null);
  const [celebrationMonth, setCelebrationMonth] = useState(null);
  const [celebrationSteps, setCelebrationSteps] = useState([]);
  const [celebrationWeek, setCelebrationWeek] = useState(null);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => { loadData(); }, [id]);

  // Poll every 2s while background months are still being created (max 2 minutes)
  useEffect(() => {
    if (loading || !goal) return;
    const timelineMatch = goal.timeline?.match(/(\d+)\s*month/i);
    const totalMonths = timelineMatch ? parseInt(timelineMatch[1]) : 0;
    if (totalMonths === 0) return;

    let pollCount = 0;
    const maxPolls = 60; // 60 × 2s = 2 minutes max, then stop spinning

    const timer = setInterval(async () => {
      pollCount++;

      const stepsData = await base44.entities.GoalStep.filter({ goal_id: id }).catch(() => null);
      if (stepsData) {
        setSteps(stepsData.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)));
      }

      // Stop when all months have steps OR timeout reached
      const monthsWithSteps = new Set(
        (stepsData || []).map(s => s.phase?.match(/Month\s*(\d+)/i)?.[1]).filter(Boolean)
      );
      if (pollCount >= maxPolls) {
        setLoadingTimedOut(true);
        clearInterval(timer);
      } else if (monthsWithSteps.size >= totalMonths) {
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [loading, goal?.id, id]);

  const loadData = async () => {
   try {
     const goalData = await base44.entities.Goal.list('-created_date');
     const target = goalData.find(g => g.id === id);
     if (!target) { navigate("/Goals"); return; }
     setGoal(target);
     const stepsData = await base44.entities.GoalStep.filter({ goal_id: id });
     setSteps(stepsData.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)));
   } catch (err) {
     console.error(err);
   } finally {
     setLoading(false);
   }
  };

  const toggleStepStatus = async (step) => {
    const newStatus = step.status === 'completed' ? 'pending' : 'completed';
    const updates = { status: newStatus };
    if (newStatus === 'completed') { updates.completed_at = new Date().toISOString(); }
    await base44.entities.GoalStep.update(step.id, updates);
    await loadData();
    if (newStatus === 'completed' && step.phase) {
      const weekMatch = step.phase.match(/Week\s*(\d+)/i);
      const monthMatch = step.phase.match(/Month\s*(\d+)/i);
      if (weekMatch && monthMatch) {
        const weekNum = parseInt(weekMatch[1], 10);
        const monthNum = parseInt(monthMatch[1], 10);
        
        // Week 1-3: show week celebration
        if (weekNum >= 1 && weekNum <= 3) {
          const freshSteps = await base44.entities.GoalStep.filter({ goal_id: id });
          const weekSteps = freshSteps.filter(s => s.phase && s.phase.match(new RegExp('Month\\s*' + monthNum, 'i')) && s.phase.match(new RegExp('Week\\s*' + weekNum, 'i')));
          if (weekSteps.length > 0 && weekSteps.every(s => s.status === 'completed')) {
            setCelebrationWeek(weekNum);
          }
        }
        
        // Week 4: show month celebration
        if (weekNum === 4) {
          const freshSteps = await base44.entities.GoalStep.filter({ goal_id: id });
          const week4Steps = freshSteps.filter(s => s.phase && s.phase.match(new RegExp('Month\\s*' + monthNum, 'i')) && s.phase.match(/Week\s*4/i));
          if (week4Steps.length > 0 && week4Steps.every(s => s.status === 'completed')) {
            const monthSteps = freshSteps.filter(s => s.phase && s.phase.match(new RegExp('Month\\s*' + monthNum, 'i')) && s.status === 'completed');
            setCelebrationSteps(monthSteps);
            setCelebrationMonth(monthNum);
          }
        }
      }
    }
  };

  const deleteGoal = () => {
    const goalTitle = goal.title;
    const goalId = goal.id;
    // Mark as deleted in sessionStorage so Goals page hides it immediately
    const deleted = JSON.parse(sessionStorage.getItem('deletedGoalIds') || '[]');
    deleted.push(goalId);
    sessionStorage.setItem('deletedGoalIds', JSON.stringify(deleted));
    // Navigate away immediately — don't wait for anything
    navigate("/Goals");
    toast({ title: "Goal deleted", description: `"${goalTitle}" has been removed.`, duration: 3000 });
    // Delete in background asynchronously
    base44.functions.invoke('deleteGoalWithNotifications', { goal_id: goalId }).catch(err => console.error("Background deletion failed:", err));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
      </div>
    );
  }

  if (!goal) return null;

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

  // Build month->week->steps hierarchy with titles from goal.month_titles
   const monthsMap = {};
   const weekTitles = {};

   steps.forEach(s => {
     const phase = s.phase || '';
     const monthMatch = phase.match(/Month\s*(\d+)/i);
     const weekMatch = phase.match(/Week\s*(\d+)/i);
     // Skip steps with no recognizable month — don't show as "Uncategorized"
     if (!monthMatch) return;
     const monthKey = `Month ${parseInt(monthMatch[1], 10)}`;
     const weekKey = weekMatch ? `Week ${parseInt(weekMatch[1], 10)}` : null;

     if (!monthsMap[monthKey]) monthsMap[monthKey] = {};
     const bucket = weekKey || '_month';
     if (!monthsMap[monthKey][bucket]) monthsMap[monthKey][bucket] = [];
     monthsMap[monthKey][bucket].push(s);

     // Extract week title from first step with description in this week
     if (weekKey && !weekTitles[`${monthKey}-${weekKey}`] && s.description) {
       const firstLine = s.description.split('\n')[0].trim();
       if (firstLine && !/^week/i.test(firstLine)) {
         weekTitles[`${monthKey}-${weekKey}`] = firstLine;
       }
     }
   });

   // Build month titles from goal.month_titles
   const monthTitles = {};
   if (goal.month_titles) {
     Object.entries(goal.month_titles).forEach(([monthNum, title]) => {
       const monthKey = `Month ${monthNum}`;
       monthTitles[monthKey] = title;
     });
   }

  const monthSort = (a, b) => {
    const n = (k) => { const m = k.match(/(\d+)/); return m ? parseInt(m[1], 10) : 999; };
    return n(a) - n(b);
  };
  const sortedMonths = Object.keys(monthsMap).sort(monthSort);

  // Add placeholder entries for months that haven't been created yet (background creation)
  const timelineMonthsMatch = goal.timeline?.match(/(\d+)\s*month/i);
  const totalExpectedMonths = timelineMonthsMatch ? parseInt(timelineMonthsMatch[1]) : 0;
  const loadingMonthPlaceholders = [];
  for (let m = 1; m <= totalExpectedMonths; m++) {
    const key = `Month ${m}`;
    if (!monthsMap[key]) loadingMonthPlaceholders.push(key);
  }

  return (
    <div className="min-h-screen pb-32 px-4 pt-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <button onClick={() => navigate("/Goals")} className="mb-4 text-violet-600 hover:text-violet-700 flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back to Goals
        </button>

        {/* Goal Info */}
        <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{goal.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 capitalize">{goal.category}</span>
                {goal.timeline && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar className="w-3 h-3" /> {goal.timeline}
                  </span>
                )}
                {goal.status && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    goal.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {goal.status}
                  </span>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {goal.plan_summary && (
            <p className="text-gray-700 mb-4 leading-relaxed whitespace-pre-wrap">
              {goal.plan_summary.split(/(\[Click here\]|\(https?:\/\/[^\)]+\))/g).map((part, idx) => {
                const urlMatch = part.match(/\(https?:\/\/([^\)]+)\)/);
                if (urlMatch) {
                  const url = urlMatch[1];
                  return (
                    <a key={idx} href={`https://${url}`} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-700 hover:underline font-semibold">
                      {part}
                    </a>
                  );
                }
                return part;
              })}
            </p>
          )}

          {/* Progress */}
          {steps.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700">{completedSteps} of {steps.length} steps done</span>
                <span className="text-sm font-bold text-violet-600">{progress}%</span>
              </div>
              <div className="h-2 bg-white rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>



        {/* Steps - Month/Week Hierarchy */}
        <div className="space-y-3">
          {sortedMonths.map(monthKey => {
             const monthNum = parseInt(monthKey.match(/\d+/)?.[0] || 0);
             const weeksMap = monthsMap[monthKey];
             const allMonthSteps = Object.values(weeksMap).flat();
             const isLoadingMonth = allMonthSteps.length === 0; // Show loading only if no steps yet
             const isMonthOpen = expandedPhases[monthKey];
             const sortedWeeks = Object.keys(weeksMap).filter(w => w !== '_month').sort(monthSort);
             const monthOnlySteps = weeksMap['_month'] || [];

            return (
              <div key={monthKey} className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Month header */}
                <button
                  onClick={() => !isLoadingMonth && setExpandedPhases(prev => ({ ...prev, [monthKey]: !prev[monthKey] }))}
                  className={`w-full flex items-center gap-3 px-4 py-3 bg-white transition-all text-left ${!isLoadingMonth && 'hover:bg-gray-50'}`}
                  disabled={isLoadingMonth}
                >
                  <div className="w-1.5 h-5 bg-violet-500 rounded-full flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-gray-900">{monthKey}</h3>
                    {monthTitles[monthKey] && (
                      <p className="text-xs text-violet-500 mt-0.5">— {monthTitles[monthKey].replace(/\*+/g, '').trim()}</p>
                    )}
                  </div>
                  {isLoadingMonth ? (
                    <Loader2 className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" />
                  ) : (
                    <>
                      <span className="text-xs text-gray-400 mr-2">{allMonthSteps.filter(s => s.status === 'completed').length}/{allMonthSteps.length}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMonthOpen ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>

                {/* Month content */}
                {isLoadingMonth ? (
                  <div className="border-t border-gray-100 bg-gray-50 px-3 py-6 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                      <p className="text-xs">Creating plan…</p>
                    </div>
                  </div>
                ) : isMonthOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 space-y-2">
                    {/* Month-level steps (no week) */}
                    {monthOnlySteps.map(step => <StepRow key={step.id} step={step} onOpen={() => { setSelectedStep(step); setIsStepModalOpen(true); }} onToggle={() => toggleStepStatus(step)} onCheckIn={() => setHabitCheckInStep(step)} onUpdate={loadData} />)}

                    {/* Week dropdowns */}
                    {sortedWeeks.map(weekKey => {
                      const weekSteps = weeksMap[weekKey];
                      const weekId = `${monthKey}-${weekKey}`;
                      const isWeekOpen = expandedPhases[weekId];
                      return (
                        <div key={weekKey} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                          <button
                            onClick={() => setExpandedPhases(prev => ({ ...prev, [weekId]: !prev[weekId] }))}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-all text-left"
                          >
                            <div className="w-1 h-4 bg-indigo-300 rounded-full flex-shrink-0" />
                            <div className="flex-1 flex items-baseline gap-2">
                              <span className="text-xs font-semibold text-gray-700">{weekKey}</span>
                              {weekTitles[weekId] && (
                                <span className="text-xs text-gray-500">— {weekTitles[weekId]}</span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400 mr-2">{weekSteps.filter(s => s.status === 'completed').length}/{weekSteps.length}</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isWeekOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {isWeekOpen && (
                            <div className="border-t border-gray-100 px-2 py-2 space-y-2">
                              {weekSteps.map(step => <StepRow key={step.id} step={step} onOpen={() => { setSelectedStep(step); setIsStepModalOpen(true); }} onToggle={() => toggleStepStatus(step)} onCheckIn={() => setHabitCheckInStep(step)} onUpdate={loadData} />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {/* Loading placeholders for months not yet created in background */}
          {!loadingTimedOut && loadingMonthPlaceholders.map(monthKey => (
            <div key={monthKey} className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="w-full flex items-center gap-3 px-4 py-3 bg-white">
                <div className="w-1.5 h-5 bg-violet-200 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-400">{monthKey}</h3>
                  {monthTitles[monthKey] && (
                    <p className="text-xs text-violet-300 mt-0.5">— {monthTitles[monthKey]}</p>
                  )}
                </div>
                <Loader2 className="w-4 h-4 text-violet-400 animate-spin flex-shrink-0" />
              </div>
              <div className="border-t border-gray-100 bg-gray-50 px-3 py-4 flex items-center justify-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <p className="text-xs">Creating plan…</p>
              </div>
            </div>
          ))}

          {steps.length === 0 && loadingMonthPlaceholders.length === 0 && (
            <Card className="bg-gray-50 border-gray-200">
              <CardContent className="p-6 text-center text-gray-400">No steps yet. Check back when the plan is created.</CardContent>
            </Card>
          )}
        </div>

        {/* Completion History */}
         {steps.some(s => s.completed_at) && (
           <div className="mt-8 pt-6 border-t border-gray-200">
             <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
               <History className="w-4 h-4 text-violet-600" />
               Completion History
             </h3>
             <div className="space-y-2">
               {steps
                 .filter(s => s.completed_at)
                 .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
                 .map(step => (
                   <div key={step.id} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                     <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                     <div className="flex-1 min-w-0">
                       <p className="text-sm font-medium text-green-900">{step.title}</p>
                       <p className="text-xs text-green-600 mt-1">
                         Completed {new Date(step.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                       </p>
                     </div>
                   </div>
                 ))}
             </div>
           </div>
         )}

        {/* Notes */}
         {goal.notes && (
           <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-4">
             <p className="text-xs font-semibold text-amber-900 mb-2">Notes</p>
             <p className="text-sm text-amber-800">{goal.notes}</p>
           </div>
         )}
        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-gray-900">Delete this goal?</DialogTitle>
              <DialogDescription className="text-gray-500 mt-1">
                This will permanently delete <span className="font-semibold text-gray-700">"{goal?.title}"</span> and all its steps. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 mt-2">
              <Button onClick={deleteGoal} className="w-full rounded-xl bg-red-600 hover:bg-red-700 text-white">
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Step Details Modal */}
        <StepDetailsModal
          step={selectedStep}
          isOpen={isStepModalOpen}
          onClose={() => setIsStepModalOpen(false)}
          onUpdate={loadData}
        />

        {/* Habit Check-In Modal */}
        <HabitCheckInModal
          step={habitCheckInStep}
          onClose={() => setHabitCheckInStep(null)}
          onCheckedIn={loadData}
        />
      </div>
      {celebrationMonth && (
        <MonthCelebrationModal
          monthNumber={celebrationMonth}
          completedSteps={celebrationSteps}
          onClose={() => setCelebrationMonth(null)}
        />
      )}
      {celebrationWeek && (
        <WeekCelebrationModal
          weekNumber={celebrationWeek}
          onClose={() => setCelebrationWeek(null)}
        />
      )}
    </div>
  );
}