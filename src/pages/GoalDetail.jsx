import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2, Calendar, CheckCircle2, Clock, AlertCircle, Plus, Trash2 } from "lucide-react";

export default function GoalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [goal, setGoal] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);

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
    await base44.entities.GoalStep.update(step.id, {
      status: newStatus,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null
    });
    await loadData();
  };

  const deleteGoal = async () => {
    if (!confirm("Delete this goal? This cannot be undone.")) return;
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

  const stepsByPhase = {};
  steps.forEach(s => {
    const phase = s.phase || 'Uncategorized';
    if (!stepsByPhase[phase]) stepsByPhase[phase] = [];
    stepsByPhase[phase].push(s);
  });

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
            <Button variant="outline" size="sm" onClick={deleteGoal} className="text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {goal.plan_summary && <p className="text-gray-700 mb-4 leading-relaxed">{goal.plan_summary}</p>}

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

        {/* Steps */}
        <div className="space-y-6">
          {Object.entries(stepsByPhase).map(([phase, phaseSteps]) => (
            <div key={phase}>
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
                <div className="w-1 h-4 bg-violet-400 rounded-full" />
                {phase}
              </h3>
              <div className="space-y-2">
                {phaseSteps.map(step => (
                  <StepCard key={step.id} step={step} onToggle={() => toggleStepStatus(step)} />
                ))}
              </div>
            </div>
          ))}
          {steps.length === 0 && (
            <Card className="bg-gray-50 border-gray-200">
              <CardContent className="p-6 text-center text-gray-400">No steps yet. Check back when the plan is created.</CardContent>
            </Card>
          )}
        </div>

        {/* Notes */}
        {goal.notes && (
          <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-900 mb-2">Notes</p>
            <p className="text-sm text-amber-800">{goal.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({ step, onToggle }) {
  const priorityColors = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-700',
  };

  const statusConfig = {
    completed: { icon: CheckCircle2, color: 'text-green-600' },
    in_progress: { icon: Clock, color: 'text-blue-600' },
    pending: { icon: Clock, color: 'text-gray-400' },
    skipped: { icon: AlertCircle, color: 'text-gray-400' },
  };

  const StatusIcon = statusConfig[step.status]?.icon || Clock;

  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        step.status === 'completed'
          ? 'bg-green-50 border-green-100'
          : 'bg-white border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Checkbox
            checked={step.status === 'completed'}
            onChange={(e) => e.stopPropagation()}
            className="mt-0.5"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`font-medium text-sm ${step.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {step.title}
          </h4>
          {step.description && (
            <p className={`text-xs mt-1 leading-relaxed ${step.status === 'completed' ? 'text-gray-400' : 'text-gray-500'}`}>
              {step.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {step.priority && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${priorityColors[step.priority] || priorityColors.medium}`}>
                {step.priority}
              </span>
            )}
            {step.due_date && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {new Date(step.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
        <StatusIcon className={`w-4 h-4 ${statusConfig[step.status]?.color} flex-shrink-0 mt-1`} />
      </div>
    </button>
  );
}