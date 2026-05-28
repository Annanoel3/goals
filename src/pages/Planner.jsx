import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Mic, Sparkles, Target, Plus, Check, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function Planner() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'plan_approved' | 'edit_approved'
  const [pendingGoalId, setPendingGoalId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [goals, setGoals] = useState([]);
  const [editingGoal, setEditingGoal] = useState(null); // goal being edited in current session
  const [userCity, setUserCity] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesRef = useRef(messages);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load goals and user city
  useEffect(() => {
    base44.entities.Goal.filter({ status: 'active' }).then(setGoals).catch(() => {});
    base44.auth.me().then(u => { if (u?.city) setUserCity(u.city); }).catch(() => {});

    // If navigated here with ?edit=goalId, auto-start edit session
    const editId = searchParams.get('edit');
    if (editId) {
      base44.entities.Goal.list().then(all => {
        const goal = all.find(g => g.id === editId);
        if (goal) startEditSession(goal);
      });
    }

    // If navigated here with ?nudge=goalId&message=..., auto-start edit session with AI nudge message
    const nudgeGoalId = searchParams.get('nudge');
    const nudgeMessage = searchParams.get('message');
    if (nudgeGoalId && nudgeMessage) {
      base44.entities.Goal.list().then(all => {
        const goal = all.find(g => g.id === nudgeGoalId);
        if (goal) {
          setEditingGoal(goal);
          setMessages([{ role: "assistant", content: decodeURIComponent(nudgeMessage) }]);
          setPendingAction(null);
          setSaved(false);
        }
      });
    }
  }, []);

  const startEditSession = (goal) => {
    setEditingGoal(goal);
    setMessages([{
      role: "assistant",
      content: `I'm ready to help you update **"${goal.title}"**. What would you like to change?`,
      editExamples: [
        "Extend the timeline by 2 months",
        "Make the steps easier and more manageable",
        "I've been slacking — help me get back on track",
        "Add a new phase focused on accountability",
        "Remove Month 3 and compress the rest",
        "Change my goal's focus to be more practical",
        "I finished early — what should I do next?",
        "The deadlines feel too tight, can you loosen them?",
      ]
    }]);
    setPendingAction(null);
    setSaved(false);
  };

  const handleNewPlan = () => {
    setMessages([]);
    setPendingAction(null);
    setPendingGoalId(null);
    setSaved(false);
    setInput("");
    setEditingGoal(null);
  };

  const sendMessage = useCallback(async (content) => {
    if (!content.trim() || isLoading) return;
    const userMsg = { role: "user", content: content.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const allMessages = [...messagesRef.current, userMsg];
      const payload = {
        messages: allMessages.filter(m => m.role !== "system"),
        mode: "chat",
        city: userCity,
        existing_goals: goals.map(g => ({ id: g.id, title: g.title })),
      };
      if (editingGoal) payload.goal_id = editingGoal.id;

      const res = await base44.functions.invoke("goalPlannerChat", payload);
      const { message, action, goal_id } = res.data;

      setMessages(prev => [...prev, { role: "assistant", content: message }]);

      if (action === 'plan_proposed' || (action === 'chat' && message?.includes('Month 1') && (message?.includes('Month 2') || message?.includes('Week 1')))) {
        setPendingAction('plan_proposed');
      } else if (action === 'plan_approved' || message?.includes('PLAN_APPROVED')) {
        setPendingAction('plan_approved');
      } else if (action === 'edit_approved' || message?.includes('EDIT_APPROVED')) {
        setPendingAction('edit_approved');
        const resolvedGoalId = goal_id || editingGoal?.id;
        setPendingGoalId(resolvedGoalId);
        // If we weren't already in an edit session, set it now
        if (!editingGoal && resolvedGoalId) {
          const found = goals.find(g => g.id === resolvedGoalId);
          if (found) setEditingGoal(found);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, editingGoal, goals, userCity]);

  const validatePlanSteps = (plan) => {
    if (!plan.steps || plan.steps.length === 0) {
      throw new Error("No steps found in plan. Please try again.");
    }

    // Check for month gaps
    const timelineMatch = plan.timeline?.match(/(\d+)\s*month/i);
    const expectedMonths = timelineMatch ? parseInt(timelineMatch[1], 10) : null;
    
    if (expectedMonths && expectedMonths >= 3) {
      const monthCounts = {};
      plan.steps.forEach(s => {
        const monthMatch = (s.phase || '').match(/Month (\d+)/i);
        if (monthMatch) {
          monthCounts[parseInt(monthMatch[1], 10)] = true;
        }
      });
      
      const missing = [];
      for (let i = 1; i <= expectedMonths; i++) {
        if (!monthCounts[i]) missing.push(i);
      }
      
      if (missing.length > 0) {
        throw new Error(`Plan incomplete: missing Month ${missing.join(', Month ')}. Expected all ${expectedMonths} months.`);
      }
    }
    
    // Warn if too few steps
    if (plan.steps.length < 15) {
      console.warn(`Warning: Only ${plan.steps.length} steps for ${plan.timeline} goal (expected 15+). Plan may lack detail.`);
    }
  };

  const handleSaveNewGoal = async () => {
    setIsSaving(true);
    try {
      const allMessages = messagesRef.current.filter(m => m.role !== "system");
      const res = await base44.functions.invoke("goalPlannerChat", { messages: allMessages, mode: "extract_plan" });
      
      if (res.data?.error) {
        throw new Error(res.data.error);
      }
      
      const plan = res.data.plan;
      validatePlanSteps(plan);

      const goal = await base44.entities.Goal.create({
        title: plan.title,
        description: plan.description,
        plan_summary: plan.plan_summary,
        timeline: plan.timeline,
        target_date: plan.target_date,
        category: plan.category || "personal",
        status: "active",
        preferred_time: plan.preferred_time || null,
        reminder_interval: plan.reminder_interval || "2hours",
        conversation_history: allMessages
      });

      if (plan.steps?.length > 0) {
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];
          const createdStep = await base44.entities.GoalStep.create({
            goal_id: goal.id,
            title: step.title,
            description: step.description || "",
            phase: step.phase || "",
            priority: step.priority || "medium",
            due_date: step.due_date || "",
            order_index: step.order_index ?? i,
            status: "pending",
            step_resources: step.step_resources || [],
            success_criteria: step.success_criteria || [],
            tips_and_guidance: step.tips_and_guidance || "",
            is_daily_habit: step.is_daily_habit === true
          });

          // Create sub-steps if provided
          if (step.sub_steps?.length > 0) {
            for (const subStep of step.sub_steps) {
              await base44.entities.GoalStep.create({
                goal_id: goal.id,
                parent_step_id: createdStep.id,
                title: subStep.title,
                description: subStep.description || "",
                phase: step.phase || "",
                priority: subStep.priority || "low",
                due_date: subStep.due_date || "",
                order_index: 0,
                status: "pending"
              });
            }
          }
        }
      }

      setSaved(true);
      setPendingGoalId(goal.id);

      // Schedule all notifications for this goal in the background
      base44.functions.invoke('scheduleGoalNotifications', { goal_id: goal.id }).catch(() => {});
    } catch (err) {
      toast({ title: "Error saving goal", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyEdits = async () => {
    setIsSaving(true);
    try {
      const allMessages = messagesRef.current.filter(m => m.role !== "system");
      await base44.functions.invoke("goalPlannerChat", {
        messages: allMessages,
        mode: "apply_edit",
        goal_id: pendingGoalId || editingGoal?.id
      });

      setSaved(true);

      // Reschedule all notifications for this goal (cancels old ones first)
      const gid = pendingGoalId || editingGoal?.id;
      if (gid) {
        base44.functions.invoke('scheduleGoalNotifications', { goal_id: gid }).catch(() => {});
      }
    } catch (err) {
      toast({ title: "Error applying changes", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        stream.getTracks().forEach(t => t.stop());
        if (blob.size === 0) { setIsRecording(false); return; }
        setIsLoading(true);
        try {
          const base64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });
          const sttRes = await base44.functions.invoke('transcribeAudio', { audio_base64: base64, filename: `voice-${Date.now()}.webm` });
          if (sttRes?.data?.text) await sendMessage(sttRes.data.text);
        } catch {
          toast({ title: "Could not transcribe audio", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const isEmpty = messages.length === 0;
  const hasGoals = goals.length > 0;
  const [theme] = React.useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const isColorful = theme === 'colorful';
  const isDark = theme === 'dark';

  // Show saved chats list if we have goals and aren't currently editing
  const showGoalsList = hasGoals && !editingGoal && isEmpty;

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-gray-950' : isColorful ? 'bg-gradient-to-br from-purple-200 via-pink-200 to-blue-200' : 'bg-gray-50'}`} style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>
      {/* Header */}
      <div className={`fixed top-0 left-0 right-0 z-50 ${isDark ? 'bg-gray-900/90 border-gray-800' : isColorful ? 'bg-gradient-to-r from-purple-300/90 to-pink-300/90 border-purple-300/50' : 'bg-white/90 border-gray-100'} backdrop-blur-lg border-b px-4 py-3`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className={`text-base font-bold ${isDark ? 'text-white' : 'text-gray-900'} leading-none truncate`}>
                {editingGoal ? `Editing: ${editingGoal.title}` : showGoalsList ? 'My Goals' : 'Planner'}
              </h1>
              <p className={`text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'} mt-0.5`}>
                {editingGoal ? 'Evolve your goal' : showGoalsList ? 'Click to adjust' : 'AI-powered goal planning'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(editingGoal || messages.length > 0) && (
              <Button variant="ghost" size="sm" onClick={handleNewPlan} className={`text-xs h-7 px-3 rounded-full ${isDark ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500'}`}>
                {editingGoal ? 'Back' : 'New'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`text-xs h-7 px-3 rounded-full ${isDark ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}
              onClick={() => navigate("/Goals")}
            >
              <Target className="w-3 h-3 mr-1" />
              Goals
            </Button>
          </div>
        </div>
      </div>

      {/* Messages / Goals List */}
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 pt-24 space-y-4">
        {showGoalsList ? (
          <GoalsList goals={goals} onSelectGoal={startEditSession} onNewChat={handleNewPlan} />
        ) : isEmpty ? (
          <EmptyState onExampleClick={sendMessage} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onExampleClick={i === 0 ? sendMessage : null} />
            ))}
            {isLoading && (
        <div className="flex justify-center py-4">
          <div className="flex gap-1.5 items-center">
            <div className="w-2.5 h-2.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
            <div className="w-2.5 h-2.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
            <div className="w-2.5 h-2.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
          </div>
        </div>
      )}

            {/* Plan preview before approval */}
            {pendingAction === 'plan_proposed' && !isLoading && !saved && !editingGoal && !showCelebration && (
              <div className="flex flex-col items-center gap-3 pt-4 pb-4">
                <Button
                  onClick={() => setShowCelebration(true)}
                  className={`rounded-2xl px-6 py-2.5 font-semibold ${isDark ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-100'}`}
                >
                  <Check className="w-4 h-4 mr-2" />
                  Looks good!
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sendMessage("I'd like to work on it some more")}
                  className={`rounded-2xl px-6 py-2.5 border-2 font-semibold ${isDark ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  I'd like to work on it some more
                </Button>
              </div>
            )}

            {pendingAction === 'plan_proposed' && !isLoading && !saved && !editingGoal && showCelebration && (
        <GifCarousel gifs={COMIC_GIFS} onComplete={handleSaveNewGoal} />
      )}

      {/* New goal approval */}
           {pendingAction === 'plan_approved' && !saved && !isSaving && (
             <div className="flex justify-center py-4">
               <Button
                 onClick={handleSaveNewGoal}
                 className={`rounded-2xl px-6 py-2.5 font-semibold ${isDark ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-100'}`}
               >
                 <Plus className="w-4 h-4 mr-2" />Save This Goal
               </Button>
             </div>
           )}

            {isSaving && (pendingAction === 'plan_approved' || pendingAction === 'plan_proposed') && (
              <div className="flex justify-center py-4">
                <SavingProgressBar isEdit={false} done={!isSaving} />
              </div>
            )}

            {/* Edit approval */}
            {pendingAction === 'edit_approved' && !saved && (
              <div className="flex justify-center py-2">
                {isSaving ? (
                  <SavingProgressBar isEdit />
                ) : (
                  <Button
                    onClick={handleApplyEdits}
                    className={`rounded-2xl px-6 py-2.5 font-semibold ${isDark ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/30' : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-100'}`}
                  >
                    <Check className="w-4 h-4 mr-2" />Apply Changes
                  </Button>
                )}
              </div>
            )}

            {saved && (
              <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {pendingAction === 'edit_approved' ? (
                  <>
                    <div className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold border ${isDark ? 'bg-green-900/30 text-green-400 border-green-700' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      <Check className="w-4 h-4" />
                      Changes applied!
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold border ${isDark ? 'bg-green-900/30 text-green-400 border-green-700' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      <Check className="w-4 h-4" />
                      Goal created! 🎉
                    </div>
                    <div className={`border rounded-2xl px-5 py-4 max-w-sm text-center ${isDark ? 'bg-gray-800/50 border-violet-700' : 'bg-violet-50 border-violet-100'}`}>
                      <p className={`text-sm font-medium mb-1 ${isDark ? 'text-violet-300' : 'text-violet-800'}`}>Your plan is a living document 🌱</p>
                      <p className={`text-xs leading-relaxed mb-3 ${isDark ? 'text-violet-400' : 'text-violet-600'}`}>Come back anytime to adjust difficulty, add resources, skip ahead, extend the timeline, or completely restructure a phase. Just tell me what's working and what isn't.</p>
                      <div className="flex gap-2 justify-center">
                         <Button size="sm" className={`rounded-xl text-xs font-semibold ${isDark ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white'}`} onClick={() => navigate(`/goal/${pendingGoalId}`)}>
                           Go to Goal →
                         </Button>
                         <Button size="sm" variant="outline" className={`rounded-xl text-xs font-semibold ${isDark ? 'border-violet-700 text-violet-400 hover:bg-gray-700' : 'border-violet-200 text-violet-700 hover:bg-violet-50'}`} onClick={handleNewPlan}>
                           Plan Another
                         </Button>
                       </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div className={`fixed bottom-0 left-0 right-0 ${isDark ? 'bg-gray-900/95 border-gray-800' : isColorful ? 'bg-gradient-to-r from-purple-200/95 to-pink-200/95 border-purple-300/50' : 'bg-white/95 border-gray-100'} backdrop-blur-lg border-t px-4 py-3`}
        style={{ paddingBottom: 'max(0.75rem, calc(0.75rem + env(safe-area-inset-bottom)))' }}>
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading}
            className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-100 hover:bg-gray-200'} disabled:opacity-40`}
          >
            <Mic className={`w-4 h-4 ${isRecording ? 'text-white' : 'text-gray-600'}`} />
          </button>
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={
              editingGoal
                ? `What changes do you want for "${editingGoal.title}"?`
                : isEmpty
                  ? "Tell me your goal… e.g. 'I want to learn Spanish in 5 months'"
                  : "Continue the conversation…"
            }
            className={`flex-1 min-h-[42px] max-h-32 text-sm resize-none rounded-2xl transition-colors ${isDark ? 'border-gray-700 focus:border-gray-600 bg-gray-800 focus:bg-gray-700 text-white placeholder-gray-500' : 'border-gray-200 focus:border-violet-300 bg-gray-50 focus:bg-white text-gray-900'}`}
            disabled={isLoading}
            rows={1}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="w-10 h-10 flex-shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-violet-200 hover:shadow-violet-300 transition-all disabled:opacity-40 disabled:shadow-none"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onExampleClick }) {
  const examples = [
    "I want to learn Spanish in 5 months",
    "Run a 5K in 3 months",
    "Launch a side business this year",
    "Read 24 books this year",
  ];
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mb-6 shadow-sm">
        <Sparkles className="w-10 h-10 text-violet-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">What's your goal?</h2>
      <p className="text-gray-500 text-sm max-w-xs leading-relaxed mb-8">
        Describe your goal and I'll build a detailed, phased plan with milestones to get you there.
      </p>
      <div className="space-y-2 w-full max-w-xs">
        {examples.map(ex => (
          <button
            key={ex}
            onClick={() => onExampleClick(ex)}
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 text-left hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 transition-all"
          >
            "{ex}"
          </button>
        ))}
      </div>
    </div>
  );
}

function renderInlineText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g);
  const cleanUrl = (url) => url.replace(/[.,;:!?)]+$/, '');
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.match(urlRegex)) {
      const href = cleanUrl(part);
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer"
          className="underline hover:opacity-80 transition-opacity font-semibold break-all">{href}</a>
      );
    }
    return part;
  });
}

function renderPreamble(text) {
  // Strip markdown headers, dividers, and render clean text
  const lines = text.split('\n').map(l => l
    .replace(/^#{1,6}\s+/, '')   // remove ## headers
    .replace(/^---+$/, '')        // remove --- dividers
    .replace(/\*\*/g, '')         // remove bold markers
    .trim()
  ).filter(l => l.length > 0);
  return lines.join('\n');
}

// Parse plan text into Month > Week > Tasks hierarchy
function parsePlanHierarchy(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const months = [];
  let currentMonth = null;
  let currentWeek = null;
  let preamble = [];

  // "Month 1, Week 2" or "Month 1 Week 2" — combined header
  const isCombinedHeader = (l) => /Month\s+\d+[,\s]+Week\s+\d+/i.test(l.replace(/\*\*/g, ''));
  // Pure "Month 1" header (no week) — also matches "#### Month 1 - Title"
  const isPureMonthHeader = (l) => /^(#{1,4}\s+)?(\*\*)?Month\s+\d+(\*\*)?(?:[:\s-].*)?$/i.test(l.replace(/\*\*/g, '').trim());
  // Pure "Week 1" or "Week 1:" standalone — also matches "#### Week 1 - Title"
  const isPureWeekHeader = (l) => /^(#{1,4}\s+)?(\*\*)?Week\s+\d+(\*\*)?[:\s-]*/i.test(l.replace(/\*\*/g, '').trim()) && !/Month/i.test(l);
  const isTaskLine = (l) => /^[-•*]\s+/.test(l) || /^\d+\.\s+/.test(l) || /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Day\s*\d+)/i.test(l);

  const cleanHeader = (l) => l.replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/:$/, '').trim();
  const cleanTask = (l) => l.replace(/^[-•*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();

  const getOrCreateMonth = (mNum) => {
    const mTitle = `Month ${mNum}`;
    let month = months.find(m => m.title === mTitle);
    if (!month) {
      month = { title: mTitle, weeks: [] };
      months.push(month);
    }
    return month;
  };

  for (const line of lines) {
    if (isCombinedHeader(line)) {
      // "Month 1, Week 2" — find/create month and add week to it
      const mNum = line.match(/Month\s+(\d+)/i)?.[1];
      if (mNum) {
        currentMonth = getOrCreateMonth(mNum);
        currentWeek = { title: cleanHeader(line), tasks: [] };
        currentMonth.weeks.push(currentWeek);
      }
    } else if (isPureMonthHeader(line)) {
      // Standalone "Month 1" or "#### Month 1 - Title" header
      const mNum = line.match(/Month\s+(\d+)/i)?.[1];
      if (mNum) {
        currentMonth = getOrCreateMonth(mNum);
        // Extract subtitle e.g. "Month 1 - Begin Immersion" → store as month subtitle
        const subtitle = cleanHeader(line).replace(/^Month\s+\d+\s*[-:]\s*/i, '').trim();
        // Only set subtitle if it's different from just "Month N"
        if (subtitle && !/^Month\s+\d+$/i.test(subtitle)) currentMonth.subtitle = subtitle;
        currentWeek = null;
      }
    } else if (isPureWeekHeader(line)) {
      // Standalone "Week 1" — attach to current month
      if (currentMonth) {
        const baseTitle = cleanHeader(line);
        // Keep "Week N" and any subtitle after dash/colon, strip trailing colon
        const weekTitle = baseTitle.replace(/:\s*$/, '').trim();
        currentWeek = { title: weekTitle, tasks: [] };
        currentMonth.weeks.push(currentWeek);
      }
    } else if (isTaskLine(line)) {
      const task = cleanTask(line);
      if (!task) continue;
      if (currentWeek) {
        currentWeek.tasks.push(task);
      } else if (currentMonth) {
        // Task under month but no week — create implicit week
        currentWeek = { title: 'Tasks', tasks: [] };
        currentMonth.weeks.push(currentWeek);
        currentWeek.tasks.push(task);
      }
    } else {
      if (months.length === 0) {
        preamble.push(line);
      }
      if (currentWeek && line.trim().length > 3) {
        const cleanLine = line.trim().replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/^---+$/, '').trim();
        if (cleanLine) currentWeek.description = (currentWeek.description ? currentWeek.description + ' ' : '') + cleanLine;
      }
    }
  }


  // Post-process: if a month has no explicit Week headers, auto-split into 4 weeks
  for (const month of months) {
    const hasExplicitWeeks = month.weeks.some(w => /^Week\s+\d+/i.test(w.title));
    if (!hasExplicitWeeks) {
      const allTasks = month.weeks.flatMap(w => w.tasks);
      const desc = month.weeks[0]?.description || '';
      month.weeks = [1, 2, 3, 4].map((n, idx) => ({
        title: 'Week ' + n,
        tasks: allTasks.filter((_, i) => i % 4 === idx),
        description: idx === 0 ? desc : ''
      }));
    }
  }

  // Detect total months from preamble/text ("12-month plan", "12 months", etc.)
  const totalMonthsMatch = text.match(/(\d+)[\s-]month/i);
  const totalMonths = totalMonthsMatch ? parseInt(totalMonthsMatch[1]) : 0;
  if (totalMonths > months.length) {
    for (let m = months.length + 1; m <= totalMonths; m++) {
      months.push({
        title: 'Month ' + m,
        weeks: [1,2,3,4].map(n => ({ title: 'Week ' + n, tasks: [], description: '' }))
      });
    }
  }

  // Sort months by number to ensure clean sequential order (fixes jumbled months on timeline extension)
  months.sort((a, b) => {
    const numA = parseInt(a.title.match(/\d+/)?.[0] || 999);
    const numB = parseInt(b.title.match(/\d+/)?.[0] || 999);
    return numA - numB;
  });

  return { months, preamble: preamble.join('\n') };
}

const COMIC_GIFS = [
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/Turtle.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/bear.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/bird.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/Cat.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/Dog.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/mouse.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/Squirrel.gif',
  'https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/GIFs/Robot.gif',
];

function GifCarousel({ gifs, onComplete }) {
  const [idx, setIdx] = React.useState(() => Math.floor(Math.random() * gifs.length));
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => {
      setDone(true);
      onComplete();
    }, 28000);
    return () => clearTimeout(timer);
  }, [idx, done, gifs, onComplete]);
  return (
    <div className="flex flex-col items-center justify-center py-6 animate-in fade-in duration-300">
      <img
        key={idx}
        src={gifs[idx]}
        alt="celebration"
        className="w-52 h-52 object-contain rounded-2xl shadow-lg animate-in zoom-in duration-300"
        style={{imageRendering:'auto'}}
      />
      <p className="text-sm text-gray-400 mt-3 font-medium text-center">Your goal will be ready in a few minutes.</p>
      <p className="text-xs text-gray-300 mt-1 text-center">Feel free to navigate away — we'll keep building it in the background.</p>
    </div>
  );
}

function WeekDropdown({ week }) {
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  const isDark = localStorage.getItem('adhd_theme') === 'dark';
  return (
    <div className={`border rounded-xl overflow-hidden mb-1.5 ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
      <div className={`flex items-center transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-white hover:bg-gray-50'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); setChecked(v => !v); }}
          className="pl-3 pr-1 py-2.5 flex-shrink-0"
        >
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-violet-500 border-violet-500' : isDark ? 'border-gray-600' : 'border-gray-300'}`}>
            {checked && <Check className="w-2.5 h-2.5 text-white" />}
          </div>
        </button>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-1 flex items-center gap-2 px-2 py-2.5 text-left"
        >
          <span className={`font-medium text-xs flex-1 ${checked ? isDark ? 'line-through text-gray-600' : 'line-through text-gray-400' : isDark ? 'text-gray-300' : 'text-gray-700'}`}>{week.title}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform flex-shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-400'} ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className={`px-4 pb-3 pt-2 border-t ${isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
          {week.description && (
            <p className={`text-xs leading-relaxed mb-2 italic ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{week.description}</p>
          )}
          {week.tasks.length > 0 ? (
            <ul className="space-y-1">
              {week.tasks.map((task, i) => (
                <li key={i} className={`text-xs leading-relaxed flex gap-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className={`mt-0.5 ${isDark ? 'text-violet-500' : 'text-violet-400'}`}>•</span>
                  <span>{task}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`text-xs italic ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Activities for this week</p>
          )}
        </div>
      )}
    </div>
  );
}


function MonthDropdown({ month }) {
  const [open, setOpen] = React.useState(false);
  const isDark = localStorage.getItem('adhd_theme') === 'dark';
  return (
    <div className={`border rounded-xl overflow-hidden mb-2 shadow-sm ${isDark ? 'border-gray-700' : 'border-violet-100'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-white hover:bg-violet-50/50'}`}
      >
        <div className="flex-1 min-w-0">
            <span className={`font-semibold text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{month.title}</span>
            {month.subtitle && (
              <span className={`text-xs ml-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>— {month.subtitle}</span>
            )}
          </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{month.weeks.length} weeks</span>
          {open ? <ChevronUp className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-violet-400'}`} /> : <ChevronDown className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-500' : 'text-violet-400'}`} />}
        </div>
      </button>
      {open && (
        <div className={`px-3 pb-3 pt-2 border-t ${isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-violet-50/30 border-violet-100'}`}>
          {month.weeks.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-1">No weeks found</p>
          ) : month.weeks.map((week, i) => (
            <WeekDropdown key={i} week={week} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanView({ text }) {
  const { months, preamble } = parsePlanHierarchy(text);
  const cleanedPreamble = preamble ? renderPreamble(preamble) : '';
  return (
    <div>
      {cleanedPreamble && (
        <p className="text-sm text-gray-800 leading-relaxed mb-3 whitespace-pre-wrap">{renderInlineText(cleanedPreamble)}</p>
      )}
      {months.length > 0 ? (
        months.map((month, i) => <MonthDropdown key={i} month={month} />)
      ) : (
        <span className="whitespace-pre-wrap text-sm">{renderInlineText(text)}</span>
      )}
    </div>
  );
}

function MessageBubble({ msg, onExampleClick }) {
  const isUser = msg.role === "user";
  const isDark = localStorage.getItem('adhd_theme') === 'dark';

  const isPlanMessage = (text) => {
    return /Month\s+\d+/i.test(text) && /Week\s+\d+/i.test(text);
  };

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full`}>
        {!isUser && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-1 shadow-sm ${isDark ? 'bg-violet-700' : 'bg-gradient-to-br from-violet-500 to-indigo-600'}`}>
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? isDark ? 'bg-violet-700 text-white rounded-br-sm shadow-md shadow-violet-900/30' : 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-sm shadow-md shadow-violet-100'
            : isDark ? 'bg-gray-800 border border-gray-700 text-gray-100 rounded-bl-sm shadow-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm'
        }`}>
          {isUser ? renderInlineText(msg.content) : (
            isPlanMessage(msg.content) ? (
              <PlanView text={msg.content} />
            ) : (
              <span className="whitespace-pre-wrap">{renderInlineText(msg.content)}</span>
            )
          )}
        </div>
      </div>
      {/* Edit example chips — only on first assistant message when editing */}
      {!isUser && msg.editExamples && onExampleClick && (
        <div className="ml-9 mt-2 flex flex-wrap gap-2 max-w-[88%]">
          {msg.editExamples.map((ex) => (
            <button
              key={ex}
              onClick={() => onExampleClick(ex)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                isDark
                  ? 'bg-gray-800 border-gray-600 text-gray-300 hover:border-violet-500 hover:text-violet-300 hover:bg-gray-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
              }`}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SavingProgressBar({ isEdit = false, done = false }) {
  const newGoalSteps = [
    "Laying out the timeline…",
    "Structuring your milestones…",
    "Making sure the goal is achievable…",
    "Adding resources and guidance…",
    "Setting up success criteria…",
    "Building your step-by-step plan…",
    "Almost there…",
  ];
  const editSteps = [
    "Reading your requested changes…",
    "Updating the milestones…",
    "Making sure everything fits together…",
    "Applying your edits…",
    "Almost done…",
  ];
  const steps = isEdit ? editSteps : newGoalSteps;
  const [stepIndex, setStepIndex] = React.useState(0);
  const [progress, setProgress] = React.useState(5);

  React.useEffect(() => {
    if (done) {
      setProgress(100);
      setStepIndex(steps.length - 1);
      return;
    }
    // Crawl to max 90% while still saving — never reaches 100 until done
    const totalDuration = isEdit ? 8000 : 50000;
    const interval = totalDuration / steps.length;
    const stepTimer = setInterval(() => {
      setStepIndex(i => Math.min(i + 1, steps.length - 1));
    }, interval);
    const progressTimer = setInterval(() => {
      setProgress(p => Math.min(p + 1, 90));
    }, totalDuration / 90);
    return () => { clearInterval(stepTimer); clearInterval(progressTimer); };
  }, [done]);

  const isDark = localStorage.getItem('adhd_theme') === 'dark';
  return (
    <div className={`w-full max-w-sm border rounded-2xl px-5 py-4 shadow-md ${isDark ? 'bg-gray-800 border-gray-700 shadow-gray-900/30' : 'bg-white border-violet-100 shadow-violet-50'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className={`w-4 h-4 animate-spin flex-shrink-0 ${isDark ? 'text-violet-500' : 'text-violet-500'}`} />
        <p className={`text-sm font-medium transition-all duration-500 ${isDark ? 'text-violet-400' : 'text-violet-800'}`}>{steps[stepIndex]}</p>
      </div>
      <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-violet-100'}`}>
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${isDark ? 'bg-violet-600' : 'bg-gradient-to-r from-violet-500 to-indigo-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className={`text-xs mt-2 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>This usually takes 1–2 minutes. Feel free to navigate away.</p>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GoalsList({ goals, onSelectGoal, onNewChat }) {
  const isDark = localStorage.getItem('adhd_theme') === 'dark';
  return (
    <div className="flex flex-col items-center py-12 px-6">
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-sm ${isDark ? 'bg-violet-900/40' : 'bg-gradient-to-br from-violet-100 to-indigo-100'}`}>
        <Target className={`w-10 h-10 ${isDark ? 'text-violet-400' : 'text-violet-600'}`} />
      </div>
      <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Your Goals</h2>
      <p className={`text-sm max-w-xs leading-relaxed mb-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Click any goal to refine, extend, or adjust your plan.
      </p>
      <div className="w-full max-w-sm space-y-3 mb-8">
        {goals.map(goal => (
          <button
            key={goal.id}
            onClick={() => onSelectGoal(goal)}
            className={`w-full border rounded-xl px-4 py-3.5 text-left transition-all group ${isDark ? 'bg-gray-800 border-gray-700 hover:border-violet-600 hover:bg-gray-700' : 'bg-white border-gray-200 hover:border-violet-300 hover:bg-violet-50 hover:shadow-md'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm truncate ${isDark ? 'text-gray-100 group-hover:text-violet-400' : 'text-gray-900 group-hover:text-violet-700'}`}>{goal.title}</p>
                <p className={`text-xs mt-1 line-clamp-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{goal.timeline || 'Timeline TBD'}</p>
              </div>
              <ChevronRight className={`w-4 h-4 flex-shrink-0 mt-1 ${isDark ? 'text-gray-600 group-hover:text-violet-500' : 'text-gray-400 group-hover:text-violet-600'}`} />
            </div>
          </button>
        ))}
      </div>
      <Button
        onClick={onNewChat}
        className={`rounded-2xl px-6 py-2.5 font-semibold ${isDark ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-100'}`}
      >
        <Plus className="w-4 h-4 mr-2" />
        Plan New Goal
      </Button>
    </div>
  );
}