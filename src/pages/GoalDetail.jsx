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

        {/* Steps - Month/Week Hierarchy */}
         <div className="space-y-3">
           {Object.entries(stepsByPhase).map(([phase, phaseSteps]) => {
             const isPhaseOpen = expandedPhases[phase];
             // Group steps by week within each month
             const stepsByWeek = {};
             phaseSteps.forEach(s => {
               // Extract week info from phase if available (e.g., "Month 1" or "Month 1 - Week 1")
               const weekKey = s.phase?.includes("Week") ? s.phase : "Week 1";
               if (!stepsByWeek[weekKey]) stepsByWeek[weekKey] = [];
               stepsByWeek[weekKey].push(s);
             });

             return (
               <div key={phase}>
                 <button
                   onClick={() => setExpandedPhases(prev => ({ ...prev, [phase]: !prev[phase] }))}
                   className="w-full flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-lg hover:bg-gray-50 transition-all text-left group"
                 >
                   <div className={`text-gray-400 transition-transform ${isPhaseOpen ? 'rotate-180' : ''}`}>
                     {isPhaseOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                   </div>
                   <div className="w-1 h-4 bg-violet-400 rounded-full flex-shrink-0" />
                   <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide flex-1">{phase}</h3>
                   <span className="text-xs text-gray-400">{phaseSteps.filter(s => s.status === 'completed').length}/{phaseSteps.length}</span>
                 </button>
                 {isPhaseOpen && (
                   <div className="mt-2 ml-4 space-y-3 border-l-2 border-gray-100 pl-4">
                     {Object.entries(stepsByWeek).map(([week, weekSteps]) => (
                       <div key={week} className="space-y-2">
                         <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2">{week}</div>
                         <div className="space-y-2">
                           {weekSteps.map(step => (
                             <button
                               key={step.id}
                               onClick={() => {
                                 setSelectedStep(step);
                                 setIsStepModalOpen(true);
                               }}
                               className={`w-full text-left p-3 rounded-lg border transition-all ${
                                 step.status === 'completed'
                                   ? 'bg-green-50 border-green-100'
                                   : 'bg-white border-gray-100 hover:border-violet-300'
                               }`}
                             >
                               <div className="flex items-start gap-3">
                                 <div className="flex-shrink-0 mt-0.5">
                                   <Checkbox
                                     checked={step.status === 'completed'}
                                     onChange={(e) => {
                                       e.stopPropagation();
                                       toggleStepStatus(step);
                                     }}
                                     className="mt-0.5"
                                   />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                   <h4 className={`font-medium text-sm ${step.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                                     {step.title}
                                   </h4>
                                   {step.description && (
                                     <p className={`text-xs mt-1 line-clamp-2 ${step.status === 'completed' ? 'text-gray-400' : 'text-gray-500'}`}>
                                       {step.description}
                                     </p>
                                   )}
                                 </div>
                               </div>
                             </button>
                           ))}
                         </div>
                       </div>
                     ))}
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
        {/* Step Details Modal */}
        <StepDetailsModal
          step={selectedStep}
          isOpen={isStepModalOpen}
          onClose={() => setIsStepModalOpen(false)}
          onUpdate={loadData}
        />
         </div>
         </div>
         );
         }