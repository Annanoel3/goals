import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Target, MessageCircle, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function NotificationPopup() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifData, setNotifData] = useState(null);
  const [goal, setGoal] = useState(null);
  const [loadingGoal, setLoadingGoal] = useState(false);
  const hasCheckedPending = useRef(false);

  // Listen for notification click events (from OneSignalInit)
  useEffect(() => {
    const handleShowPopup = async (event) => {
      const data = event?.detail;
      if (!data) return;
      hasCheckedPending.current = true; // skip pending check if a click popup is showing
      setNotifData(data);
      setGoal(null);
      setOpen(true);

      if (data.goal_id) {
        setLoadingGoal(true);
        try {
          const goals = await base44.entities.Goal.list();
          const foundGoal = goals.find(g => g.id === data.goal_id);
          setGoal(foundGoal || null);
        } catch (e) {
          setGoal(null);
        } finally {
          setLoadingGoal(false);
        }
      }
    };

    window.addEventListener('show-notification-popup', handleShowPopup);
    return () => window.removeEventListener('show-notification-popup', handleShowPopup);
  }, []);

  // On app open: check for a pending notification stored on any goal
  useEffect(() => {
    if (hasCheckedPending.current) return;
    hasCheckedPending.current = true;

    const timer = setTimeout(async () => {
      if (open) return; // a click popup already showing
      try {
        const goals = await base44.entities.Goal.list();
        const withPending = goals.filter(g => g.pending_notification);
        if (withPending.length === 0) return;

        // Pick the most recent pending notification across all goals
        const sorted = withPending.sort((a, b) =>
          new Date(b.pending_notification.stored_at || 0) - new Date(a.pending_notification.stored_at || 0)
        );
        const latestGoal = sorted[0];
        const notif = latestGoal.pending_notification;

        // Clear it immediately so it only ever shows once
        try {
          await base44.entities.Goal.update(latestGoal.id, { pending_notification: null });
        } catch (_) { /* best effort */ }

        setNotifData({
          title: notif.title,
          body: notif.body,
          action: notif.action,
          goal_id: notif.goal_id || latestGoal.id,
          step_id: notif.step_id,
          nudge_message: notif.nudge_message,
        });
        setGoal(latestGoal);
        setOpen(true);
      } catch (e) {
        console.error('[NotificationPopup] Error checking pending notifications:', e);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleGoToGoal = () => {
    setOpen(false);
    if (notifData?.goal_id) {
      navigate(`/goal/${notifData.goal_id}`);
    } else {
      navigate('/Goals');
    }
  };

  const handleGoToChat = () => {
    setOpen(false);
    if (notifData?.goal_id) {
      const params = new URLSearchParams();
      params.set('goal_id', notifData.goal_id);
      params.set('nudge', '1');
      if (notifData.nudge_message) {
        params.set('message', encodeURIComponent(notifData.nudge_message));
      }
      navigate(`/Planner?${params.toString()}`);
    } else {
      navigate('/Planner');
    }
  };

  const title = notifData?.title || (goal ? goal.title : "Goal Update");
  const body = notifData?.body || (goal
    ? `You have an update on "${goal.title}".`
    : "You have a goal update.");

  // Smart routing: struggling → Go to Chat; just a reminder → Go to Goal
  const action = notifData?.action;
  const needsPlanAdjustment = [
    'goal_plan_nudge',
    'inactivity_nudge',
    'inactivity_monthly',
  ].includes(action);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              needsPlanAdjustment
                ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                : 'bg-gradient-to-br from-violet-500 to-indigo-600'
            }`}>
              {needsPlanAdjustment
                ? <MessageCircle className="w-5 h-5 text-white" />
                : <Sparkles className="w-5 h-5 text-white" />}
            </div>
            <DialogTitle className="text-lg">
              {loadingGoal ? "Loading..." : title}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
            {body}
          </p>
        </div>
        <DialogFooter>
          {needsPlanAdjustment ? (
            <Button onClick={handleGoToChat} className="w-full">
              <MessageCircle className="w-4 h-4 mr-2" />
              Adjust Your Plan
            </Button>
          ) : (
            <Button onClick={handleGoToGoal} className="w-full">
              <Target className="w-4 h-4 mr-2" />
              Go to Goal
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}