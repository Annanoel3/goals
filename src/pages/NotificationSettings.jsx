import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function NotificationSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [theme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const [notificationTime, setNotificationTime] = useState('10:00');
  const [notificationFrequency, setNotificationFrequency] = useState('daily');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(user => {
      if (user?.preferred_notification_time) setNotificationTime(user.preferred_notification_time);
      if (user?.notification_frequency) setNotificationFrequency(user.notification_frequency);
    }).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({ preferred_notification_time: notificationTime, notification_frequency: notificationFrequency });

      // Update preferred_time on all active goals so cron and reschedule both see the new time
      const activeGoals = await base44.entities.Goal.filter({ status: 'active' });
      await Promise.all(activeGoals.map(g =>
        base44.entities.Goal.update(g.id, { preferred_time: notificationTime })
      ));

      // Re-run scheduling so existing reminders are cancelled and recreated at the new time
      await Promise.all([
        base44.functions.invoke('rescheduleAllGoalNotifications', {}),
        base44.functions.invoke('cronDailyHabitNotifications', {}),
      ]);

      toast({ title: "Notification settings saved!" });
    } catch (err) {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setIsSaving(false);
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
        <h1 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Notifications</h1>
        <p className={`mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Control when and how often you get reminders</p>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-violet-500" /></div>
        ) : (
          <Card className={`border-none shadow-lg ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${isDark ? 'text-white' : ''}`}>
                <Bell className="w-5 h-5" /> Reminder Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  Daily reminder time
                </label>
                <input
                  type="time"
                  value={notificationTime}
                  onChange={e => setNotificationTime(e.target.value)}
                  className={`w-full px-4 py-2.5 rounded-lg border ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
                />
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  What time should we send your daily goal reminders?
                </p>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  Reminder frequency
                </label>
                <select
                  value={notificationFrequency}
                  onChange={e => setNotificationFrequency(e.target.value)}
                  className={`w-full px-4 py-2.5 rounded-lg border ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
                >
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays only</option>
                  <option value="3x_per_week">3x per week</option>
                  <option value="2x_per_week">2x per week</option>
                  <option value="once_per_week">Once per week</option>
                </select>
              </div>

              <Button onClick={handleSave} disabled={isSaving} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Settings</>}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}