import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function HabitCheckInModal({ step, onClose, onCheckedIn }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  if (!step) return null;

  const handleCheckin = async (didIt) => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    try {
      const updates = {
        habit_checkin_pending: false,
        last_habit_checkin_date: today,
      };
      if (notes.trim()) {
        updates.notes = (step.notes ? step.notes + "\n\n" : "") + `[${today}] ${notes.trim()}`;
      }
      if (didIt) {
        updates.completed_at = new Date().toISOString();
      }
      await base44.entities.GoalStep.update(step.id, updates);
      toast({
        title: didIt ? "🎉 Nice work!" : "No worries!",
        description: didIt ? "Keep that streak alive!" : "Tomorrow's another shot. You've got this!",
      });
      if (onCheckedIn) onCheckedIn();
      onClose();
    } catch {
      toast({ title: "Couldn't save check-in", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!step} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <DialogTitle className="text-gray-900 text-base">Quick check-in!</DialogTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            Did you do <span className="font-semibold text-gray-800">"{step.title}"</span> today?
          </p>
        </DialogHeader>

        <Textarea
          placeholder="Optional: any notes, wins, or struggles? (helps your AI coach improve your plan)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="text-sm resize-none rounded-xl border-gray-200 mt-2"
          rows={3}
        />

        <div className="flex gap-3 mt-1">
          <Button
            onClick={() => handleCheckin(false)}
            disabled={loading}
            variant="outline"
            className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 gap-2"
          >
            <XCircle className="w-4 h-4" /> Not today
          </Button>
          <Button
            onClick={() => handleCheckin(true)}
            disabled={loading}
            className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> Yes, I did it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}