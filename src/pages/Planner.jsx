import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Mic, Sparkles, Target, Plus, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import GoalPlanLoadingAnimation from "@/components/shared/GoalPlanLoadingAnimation";

export default function Planner() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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
  }, []);

  const startEditSession = (goal) => {
    setEditingGoal(goal);
    setMessages([{
      role: "assistant",
      content: `I'm ready to help you update your goal: **"${goal.title}"**\n\nWhat changes would you like to make? You can:\n• Add new milestones or steps\n• Extend or adjust the timeline\n• Change priorities\n• Add a whole new phase\n• Anything else — just tell me!`
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

      if (action === 'plan_approved' || message?.includes('PLAN_APPROVED')) {
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

  const handleSaveNewGoal = async () => {
    setIsSaving(true);
    try {
      const allMessages = messagesRef.current.filter(m => m.role !== "system");
      const res = await base44.functions.invoke("goalPlannerChat", { messages: allMessages, mode: "extract_plan" });
      const plan = res.data.plan;

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
        await Promise.all(plan.steps.map((step, i) =>
          base44.entities.GoalStep.create({
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
          })
        ));
      }

      setSaved(true);
      setPendingGoalId(goal.id);
      setTimeout(() => setSaved(false), 3000);
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
      setTimeout(() => setSaved(false), 3000);
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
  const [theme] = React.useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const isColorful = theme === 'colorful';

  return (
    <div className={`min-h-screen flex flex-col ${isColorful ? 'bg-gradient-to-br from-purple-200 via-pink-200 to-blue-200' : 'bg-gray-50'}`} style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${isColorful ? 'bg-gradient-to-r from-purple-300/90 to-pink-300/90 border-purple-300/50' : 'bg-white/90 border-gray-100'} backdrop-blur-lg border-b px-4 py-3`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-none">
                {editingGoal ? `Editing: ${editingGoal.title}` : 'Planner'}
              </h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {editingGoal ? 'Evolve your goal' : 'AI-powered goal planning'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleNewPlan} className="text-xs text-gray-500 h-7 px-3 rounded-full">
                New
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-3 rounded-full text-gray-500 hover:bg-gray-100"
              onClick={() => navigate("/Goals")}
            >
              <Target className="w-3 h-3 mr-1" />
              Goals
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 pt-6 space-y-4">
        {isEmpty ? (
          <EmptyState onExampleClick={sendMessage} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {isLoading && (
              <div className="flex justify-center py-4">
                <GoalPlanLoadingAnimation />
              </div>
            )}

            {/* New goal approval */}
            {pendingAction === 'plan_approved' && !saved && (
              <div className="flex justify-center py-2">
                {isSaving ? (
                  <SavingProgressBar />
                ) : (
                  <Button
                    onClick={handleSaveNewGoal}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-2xl px-6 py-2.5 shadow-lg shadow-violet-100 font-semibold"
                  >
                    <Plus className="w-4 h-4 mr-2" />Save This Goal
                  </Button>
                )}
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
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-2xl px-6 py-2.5 shadow-lg shadow-emerald-100 font-semibold"
                  >
                    <Check className="w-4 h-4 mr-2" />Apply Changes
                  </Button>
                )}
              </div>
            )}

            {saved && (
              <div className="flex flex-col items-center gap-3 py-3">
                <div className="flex items-center gap-2 bg-green-50 text-green-700 px-5 py-2.5 rounded-2xl text-sm font-semibold border border-green-200 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <Check className="w-4 h-4" />
                  {pendingAction === 'edit_approved' ? 'Changes applied!' : 'Goal saved!'}
                </div>
                {pendingAction !== 'edit_approved' && (
                  <div className="bg-violet-50 border border-violet-100 rounded-2xl px-5 py-4 max-w-sm text-center">
                    <p className="text-sm text-violet-800 font-medium mb-1">Your plan is a living document 🌱</p>
                    <p className="text-xs text-violet-600 leading-relaxed mb-3">Come back anytime to adjust difficulty, add resources, skip ahead, extend the timeline, or completely restructure a phase. Just tell me what's working and what isn't.</p>
                    <div className="flex gap-2 justify-center">
                      <Button size="sm" className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs" onClick={() => navigate("/Goals")}>
                        View Goals
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl text-xs border-violet-200 text-violet-700 hover:bg-violet-50" onClick={handleNewPlan}>
                        Plan Another
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div className={`fixed bottom-0 left-0 right-0 ${isColorful ? 'bg-gradient-to-r from-purple-200/95 to-pink-200/95 border-purple-300/50' : 'bg-white/95 border-gray-100'} backdrop-blur-lg border-t px-4 py-3`}
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
            className="flex-1 min-h-[42px] max-h-32 text-sm resize-none rounded-2xl border-gray-200 focus:border-violet-300 bg-gray-50 focus:bg-white transition-colors"
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
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.match(urlRegex)) return (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        className="underline hover:opacity-80 transition-opacity font-semibold break-all">{part}</a>
    );
    return part;
  });
}

function CollapsibleSection({ title, body }) {
  const [open, setOpen] = React.useState(false);
  // First ~8 words for the preview
  const previewWords = body.trim().split(/\s+/).slice(0, 8).join(' ');
  const hasMore = body.trim().split(/\s+/).length > 8;

  return (
    <div className="border border-gray-100 rounded-xl mb-2 overflow-hidden bg-gray-50">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-100 transition-colors"
      >
        <span className="font-semibold text-gray-800 text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>
      {!open && hasMore && (
        <div className="px-3 pb-2 relative pointer-events-none">
          <p className="text-xs text-gray-400 leading-relaxed">
            {previewWords}…
          </p>
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border-t border-gray-100 pt-2">
          {renderInlineText(body.trim())}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";

  // Parse assistant messages: detect numbered/titled sections like "1. Title:\n   - ..."
  const parseBlocks = (text) => {
    // Match patterns like: "1. Title:" or "**Month 1:**" or "### Week 1" etc.
    const sectionRegex = /^(\d+\.\s+[^\n:]+:?|#{1,3}\s+[^\n]+|\*\*[^\n*]+\*\*:?)$/;
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (sectionRegex.test(line)) {
        // Collect body lines until the next section header or end
        const title = line.replace(/^\*\*|\*\*:?$|^#{1,3}\s+/g, '').replace(/:$/, '').trim();
        let bodyLines = [];
        i++;
        while (i < lines.length && !sectionRegex.test(lines[i].trim())) {
          bodyLines.push(lines[i]);
          i++;
        }
        const body = bodyLines.join('\n').trim();
        if (body) {
          blocks.push({ type: 'section', title, body });
        } else {
          blocks.push({ type: 'text', content: line });
        }
      } else {
        // Accumulate plain text lines
        let textLines = [];
        while (i < lines.length && !sectionRegex.test(lines[i].trim())) {
          textLines.push(lines[i]);
          i++;
        }
        const content = textLines.join('\n').trim();
        if (content) blocks.push({ type: 'text', content });
      }
    }
    return blocks;
  };

  const hasSections = (text) => {
    return /^\d+\.\s+[^\n:]+:?$/m.test(text) || /^#{1,3}\s+/m.test(text);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mr-2 flex-shrink-0 mt-1 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-sm shadow-md shadow-violet-100 whitespace-pre-wrap'
          : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm'
      }`}>
        {isUser ? renderInlineText(msg.content) : (
          hasSections(msg.content) ? (
            <div>
              {parseBlocks(msg.content).map((block, i) =>
                block.type === 'section'
                  ? <CollapsibleSection key={i} title={block.title} body={block.body} />
                  : <p key={i} className="text-sm text-gray-800 leading-relaxed mb-2 whitespace-pre-wrap">{renderInlineText(block.content)}</p>
              )}
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{renderInlineText(msg.content)}</span>
          )
        )}
      </div>
    </div>
  );
}

function SavingProgressBar({ isEdit = false }) {
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
    const totalDuration = isEdit ? 8000 : 14000;
    const interval = totalDuration / steps.length;
    const stepTimer = setInterval(() => {
      setStepIndex(i => Math.min(i + 1, steps.length - 1));
    }, interval);
    const progressTimer = setInterval(() => {
      setProgress(p => Math.min(p + 1, 92));
    }, totalDuration / 92);
    return () => { clearInterval(stepTimer); clearInterval(progressTimer); };
  }, []);

  return (
    <div className="w-full max-w-sm bg-white border border-violet-100 rounded-2xl px-5 py-4 shadow-md shadow-violet-50">
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className="w-4 h-4 text-violet-500 animate-spin flex-shrink-0" />
        <p className="text-sm font-medium text-violet-800 transition-all duration-500">{steps[stepIndex]}</p>
      </div>
      <div className="h-2 bg-violet-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
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