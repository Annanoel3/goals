import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Mic, Sparkles, Target, Plus, Check } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function Planner() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [planApproved, setPlanApproved] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesRef = useRef(messages);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim() || isLoading) return;
    const userMsg = { role: "user", content: content.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const allMessages = [...messagesRef.current, userMsg];
      const res = await base44.functions.invoke("goalPlannerChat", {
        messages: allMessages,
        mode: "chat"
      });
      const { message, approved } = res.data;
      const cleanMessage = approved ? message.replace(/^PLAN_APPROVED\s*/i, '') : message;
      setMessages(prev => [...prev, { role: "assistant", content: cleanMessage }]);
      if (approved) setPlanApproved(true);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const saveGoalFromConversation = async () => {
    setIsSavingGoal(true);
    try {
      const allMessages = messagesRef.current.filter(m => m.role !== "system");
      const res = await base44.functions.invoke("goalPlannerChat", {
        messages: allMessages,
        mode: "extract_plan"
      });
      const plan = res.data.plan;

      const goal = await base44.entities.Goal.create({
        title: plan.title,
        description: plan.description,
        plan_summary: plan.plan_summary,
        timeline: plan.timeline,
        target_date: plan.target_date,
        category: plan.category || "personal",
        status: "active",
        conversation_history: allMessages
      });

      if (plan.steps && plan.steps.length > 0) {
        for (const step of plan.steps) {
          await base44.entities.GoalStep.create({
            goal_id: goal.id,
            title: step.title,
            description: step.description || "",
            phase: step.phase || "",
            priority: step.priority || "medium",
            due_date: step.due_date || "",
            order_index: step.order_index || 0,
            status: "pending"
          });
        }
      }

      setGoalSaved(true);
      toast({ title: "Goal saved!", description: `"${plan.title}" has been added to your Goals.` });
      setTimeout(() => navigate("/Goals"), 1500);
    } catch (err) {
      toast({ title: "Error", description: "Could not save the goal. Please try again.", variant: "destructive" });
    } finally {
      setIsSavingGoal(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
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
        } catch (e) {
          toast({ title: "Could not transcribe audio", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const handleNewPlan = () => {
    setMessages([]);
    setPlanApproved(false);
    setGoalSaved(false);
    setInput("");
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg border-b border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-none">Planner</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">AI-powered goal planning</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleNewPlan} className="text-xs text-gray-500 h-7 px-3 rounded-full">
                New Plan
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-3 rounded-full border-violet-200 text-violet-700 hover:bg-violet-50"
              onClick={() => navigate("/Goals")}
            >
              <Target className="w-3 h-3 mr-1" />
              My Goals
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 pt-6 space-y-4">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {isLoading && <TypingIndicator />}
            {planApproved && !goalSaved && (
              <div className="flex justify-center py-2">
                <Button
                  onClick={saveGoalFromConversation}
                  disabled={isSavingGoal}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-2xl px-6 py-2.5 shadow-lg shadow-violet-200 font-semibold"
                >
                  {isSavingGoal ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving Goal...</>
                  ) : (
                    <><Plus className="w-4 h-4 mr-2" /> Save This Goal</>
                  )}
                </Button>
              </div>
            )}
            {goalSaved && (
              <div className="flex justify-center py-2">
                <div className="flex items-center gap-2 bg-green-50 text-green-700 px-5 py-2.5 rounded-2xl text-sm font-semibold border border-green-200">
                  <Check className="w-4 h-4" />
                  Goal saved! Redirecting...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-100 px-4 py-3"
        style={{ paddingBottom: 'max(0.75rem, calc(0.75rem + env(safe-area-inset-bottom)))' }}>
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading}
            className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all ${
              isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-100 hover:bg-gray-200'
            } disabled:opacity-40`}
          >
            <Mic className={`w-4 h-4 ${isRecording ? 'text-white' : 'text-gray-600'}`} />
          </button>
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={isEmpty ? "Tell me your goal… e.g. 'I want to learn Spanish in 5 months'" : "Continue the conversation…"}
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mb-6 shadow-sm">
        <Sparkles className="w-10 h-10 text-violet-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-3">What's your goal?</h2>
      <p className="text-gray-500 text-base max-w-sm leading-relaxed mb-8">
        Tell me what you want to achieve and I'll create a detailed, personalized plan to get you there.
      </p>
      <div className="space-y-2 w-full max-w-xs">
        {[
          "Learn Spanish in 5 months",
          "Run a 5K in 3 months",
          "Launch a side business this year",
          "Read 24 books this year",
        ].map(ex => (
          <div key={ex} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 text-left">
            "{ex}"
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mr-2 flex-shrink-0 mt-1 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-sm shadow-md shadow-violet-100'
          : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm'
      }`}>
        {msg.content}
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