import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle, Calendar, Edit, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export default function GoalFollowUp() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [extendDays, setExtendDays] = useState(7);
  const [postponeDays, setPostponeDays] = useState(7);

  const goalId = searchParams.get('goal_id');

  useEffect(() => {
    if (!goalId) return;
    
    const fetchGoal = async () => {
      try {
        const results = await base44.entities.Goal.filter({ id: goalId });
        if (results.length > 0) {
          setGoal(results[0]);
        }
      } catch (error) {
        console.error('Error fetching goal:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGoal();
  }, [goalId]);

  const handleExtend = async () => {
    if (!goal) return;
    
    const currentDate = new Date(goal.target_date);
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + extendDays);

    await base44.entities.Goal.update(goal.id, {
      target_date: newDate.toISOString().split('T')[0],
    });

    // Reschedule notifications with new date
    await base44.functions.invoke('scheduleGoalNotifications', { goal_id: goal.id });

    navigate('/goal/' + goal.id);
  };

  const handlePostpone = async () => {
    if (!goal) return;
    
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + postponeDays);

    await base44.entities.Goal.update(goal.id, {
      target_date: newDate.toISOString().split('T')[0],
    });

    // Reschedule notifications
    await base44.functions.invoke('scheduleGoalNotifications', { goal_id: goal.id });

    navigate('/goal/' + goal.id);
  };

  const handleEdit = () => {
    navigate('/goal/' + goal.id);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!goal) {
    return <div className="flex items-center justify-center min-h-screen">Goal not found</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start gap-4 mb-8">
          <AlertCircle className="w-8 h-8 text-orange-500 flex-shrink-0 mt-1" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Let's regroup</h1>
            <p className="text-gray-600 mt-1">
              It looks like you didn't complete all activities for "{goal.title}" last week. No worries—let's get you back on track!
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Extend Deadline */}
          <Card className="p-6 border-2 hover:border-blue-300 cursor-pointer transition-colors" onClick={() => setShowExtendModal(true)}>
            <div className="flex items-start gap-4">
              <Calendar className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">Extend your deadline</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Give yourself more time by pushing back your goal deadline. This reschedules all your reminders.
                </p>
                <Button variant="outline" size="sm" className="mt-4">
                  Extend Deadline
                </Button>
              </div>
            </div>
          </Card>

          {/* Postpone Goal */}
          <Card className="p-6 border-2 hover:border-purple-300 cursor-pointer transition-colors" onClick={() => setShowPostponeModal(true)}>
            <div className="flex items-start gap-4">
              <Clock className="w-6 h-6 text-purple-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">Pause and restart</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Reset your goal start date. Perfect if life got in the way and you need a fresh beginning.
                </p>
                <Button variant="outline" size="sm" className="mt-4">
                  Pause & Restart
                </Button>
              </div>
            </div>
          </Card>

          {/* Edit Goal */}
          <Card className="p-6 border-2 hover:border-green-300 cursor-pointer transition-colors" onClick={handleEdit}>
            <div className="flex items-start gap-4">
              <Edit className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">Edit your plan</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Review and adjust your goal or its weekly activities to better match your pace.
                </p>
                <Button variant="outline" size="sm" className="mt-4">
                  Go to Goal
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Extend Modal */}
      <Dialog open={showExtendModal} onOpenChange={setShowExtendModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How many days do you need?</DialogTitle>
            <DialogDescription>
              Your deadline will be pushed back to give you more time to complete the activities.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {[7, 14, 30].map(days => (
                <Button
                  key={days}
                  variant={extendDays === days ? 'default' : 'outline'}
                  onClick={() => setExtendDays(days)}
                  className="flex-1"
                >
                  {days === 7 ? '1 week' : days === 14 ? '2 weeks' : '1 month'}
                </Button>
              ))}
            </div>
            <div className="text-sm text-gray-600">
              New deadline: {new Date(new Date(goal.target_date).getTime() + extendDays * 24 * 60 * 60 * 1000).toLocaleDateString()}
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowExtendModal(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleExtend}>
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Postpone Modal */}
      <Dialog open={showPostponeModal} onOpenChange={setShowPostponeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start fresh</DialogTitle>
            <DialogDescription>
              Your goal activities will start counting from today, giving you a fresh beginning.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {[7, 14, 30].map(days => (
                <Button
                  key={days}
                  variant={postponeDays === days ? 'default' : 'outline'}
                  onClick={() => setPostponeDays(days)}
                  className="flex-1"
                >
                  {days === 7 ? '1 week' : days === 14 ? '2 weeks' : '1 month'}
                </Button>
              ))}
            </div>
            <div className="text-sm text-gray-600">
              New deadline: {new Date(new Date().getTime() + postponeDays * 24 * 60 * 60 * 1000).toLocaleDateString()}
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowPostponeModal(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handlePostpone}>
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}