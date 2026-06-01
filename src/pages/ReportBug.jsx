import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bug, Send, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function ReportBug() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [theme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const [feedbackType, setFeedbackType] = useState('bug_report');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setIsSending(true);
    try {
      await base44.entities.UserFeedback.create({
        feedback_type: feedbackType,
        detailed_feedback: message.trim(),
        rating: rating || undefined,
      });
      setSent(true);
    } catch (err) {
      toast({ title: "Failed to send feedback", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen p-4 md:p-8 ${isDark ? 'bg-gray-900' : 'bg-gradient-to-br from-stone-50 to-stone-100'}`}
      style={{ paddingBottom: 'max(2rem, calc(2rem + env(safe-area-inset-bottom)))' }}>
      <div className="max-w-2xl mx-auto">
        <Button variant="ghost" onClick={() => navigate('/settings')} className="gap-2 mb-6">
          <ArrowLeft className="w-5 h-5" /> Back
        </Button>
        <h1 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Feedback</h1>
        <p className={`mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Report a bug or share a suggestion</p>

        {sent ? (
          <Card className={`border-none shadow-lg ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
            <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
              <CheckCircle className="w-16 h-16 text-green-500" />
              <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Thanks for your feedback!</h2>
              <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>We read every submission and use it to improve the app.</p>
              <Button onClick={() => navigate('/settings')} className="mt-2 bg-violet-600 hover:bg-violet-700 text-white">
                Back to Settings
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className={`border-none shadow-lg ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${isDark ? 'text-white' : ''}`}>
                <Bug className="w-5 h-5" /> Send Feedback
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>Type</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'bug_report', label: '🐛 Bug Report' },
                    { value: 'feature_request', label: '💡 Feature Request' },
                    { value: 'general', label: '💬 General' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFeedbackType(opt.value)}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                        feedbackType === opt.value
                          ? 'bg-violet-600 text-white border-violet-600'
                          : isDark ? 'bg-gray-700 text-gray-300 border-gray-600 hover:border-violet-500' : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  {feedbackType === 'bug_report' ? 'Describe the bug' : 'Your message'}
                </label>
                <Textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={feedbackType === 'bug_report' ? "What happened? What did you expect?" : "Share your thoughts..."}
                  className={`min-h-[120px] ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500' : ''}`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  Overall rating (optional)
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button key={star} onClick={() => setRating(star === rating ? null : star)}
                      className={`text-2xl transition-transform hover:scale-110 ${star <= (rating || 0) ? 'opacity-100' : 'opacity-30'}`}>
                      ⭐
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={isSending || !message.trim()}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white"
              >
                {isSending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><Send className="w-4 h-4 mr-2" />Send Feedback</>}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}