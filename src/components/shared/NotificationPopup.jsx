import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Target, MessageCircle, Sparkles, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function NotificationPopup() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifData, setNotifData] = useState(null);
  const [goal, setGoal] = useState(null);
  const [loadingGoal, setLoadingGoal] = useState(false);

  useEffect(() => {
    const handleShowPopup = async (event) => {
      const data = event?.detail;
      if (!data) return;
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
    ? `You have an update on "${goal.title}". What would you like to do?`
    : "You have a goal update. What would you like to do?");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <DialogTitle className="text-lg">
              {loadingGoal ? "Loading..." : title}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {body}
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleGoToGoal} className="w-full">
            <Target className="w-4 h-4 mr-2" />
            Go to Goal
          </Button>
          <Button onClick={handleGoToChat} variant="outline" className="w-full">
            <MessageCircle className="w-4 h-4 mr-2" />
            Go to Chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}