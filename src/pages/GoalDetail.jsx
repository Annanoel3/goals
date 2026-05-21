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

function StepRow({ step, onOpen, onToggle, onCheckIn, onUpdate }) {
  const isHabit = step.is_daily_habit || /affirm|affirmation|habit|meditat|journal|morning|exercise|daily|routine/i.test(step.title);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(step.title);
  const handleSave = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === step.title) { setEditing(false); return; }
    // Cancel existing OneSignal notification so cron recreates it with new title
    const notifIds = step.onesignal_notification_ids || [];
    if (notifIds.length > 0) {
      const lastId = notifIds[notifIds.length - 1];
      try { await base44.functions.invoke('cancelScheduled', { notificationId: lastId }); } catch(e) {}
    }
    await base44.entities.GoalStep.update(step.id, {
      title: trimmed,
      onesignal_notification_ids: []
    });
    setEditing(false);
    onUpdate();
  };
  return (
    <div className={`rounded-lg border overflow-hidden ${step.status === 'completed' ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100 hover:border-violet-300'}`}>
      <button onClick={onOpen} className="w-full text-left p-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <Checkbox checked={step.status === 'completed'} onChange={(e) => { e.stopPropagation(); onToggle(); }} />
          </div>
          <div className="flex-1 min-w-0">
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
          </div>
        </div>
      </button>
      {isHabit && step.status !== 'completed' && <HabitWeekTracker step={step} onUpdate={onUpdate} />}
      {isHabit && !step.habit_time && step.status !== 'completed' && <HabitTimePrompt step={step} onScheduled={onUpdate} />}
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [habitCheckInStep, setHabitCheckInStep] = useState(null);

  useEffect(() => { loadData(); }, [id]);

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
    if (newStatus === 'completed') {
      updates.completed_at = new Date().toISOString();
    }
    await base44.entities.GoalStep.update(step.id, updates);
    await loadData();
  };

  const deleteGoal = async () => {
    setIsDeleting(true);
    await Promise.all(steps.map(s => base44.entities.GoalStep.delete(s.id)));
    await base44.entities.Goal.delete(goal.id);
    navigate("/Goals");
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

  // Build month->week->steps hierarchy
  const monthsMap = {}; // { "Month 1": { "Week 1": [...], "Week 2": [...] }, "Month 2": { ... } }
  steps.forEach(s => {
    const phase = s.phase || 'Uncategorized';
    const monthMatch = phase.match(/Month\s*(\d+)/i);
    const weekMatch = phase.match(/Week\s*(\d+)/i);
    const monthKey = monthMatch ? `Month ${parseInt(monthMatch[1], 10)}` : 'Uncategorized';
    const weekKey = weekMatch ? `Week ${parseInt(weekMatch[1], 10)}` : null;

    if (!monthsMap[monthKey]) monthsMap[monthKey] = {};
    const bucket = weekKey || '_month';
    if (!monthsMap[monthKey][bucket]) monthsMap[monthKey][bucket] = [];
    monthsMap[monthKey][bucket].push(s);
  });

  const monthSort = (a, b) => {
    const n = (k) => { const m = k.match(/(\d+)/); return m ? parseInt(m[1], 10) : 999; };
    return n(a) - n(b);
  };
  const sortedMonths = Object.keys(monthsMap).sort(monthSort);

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
            const weeksMap = monthsMap[monthKey];
            const allMonthSteps = Object.values(weeksMap).flat();
            const isMonthOpen = expandedPhases[monthKey];
            const sortedWeeks = Object.keys(weeksMap).filter(w => w !== '_month').sort(monthSort);
            const monthOnlySteps = weeksMap['_month'] || [];

            return (
              <div key={monthKey} className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Month header */}
                <button
                  onClick={() => setExpandedPhases(prev => ({ ...prev, [monthKey]: !prev[monthKey] }))}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-all text-left"
                >
                  <div className="w-1.5 h-5 bg-violet-500 rounded-full flex-shrink-0" />
                  <h3 className="text-sm font-bold text-gray-900 flex-1">{monthKey}</h3>
                  <span className="text-xs text-gray-400 mr-2">{allMonthSteps.filter(s => s.status === 'completed').length}/{allMonthSteps.length}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMonthOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Month content */}
                {isMonthOpen && (
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
                            <span className="text-xs font-semibold text-gray-700 flex-1">{weekKey}</span>
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
          {steps.length === 0 && (
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
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button onClick={deleteGoal} disabled={isDeleting} className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white">
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
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
         </div>
         );
         }