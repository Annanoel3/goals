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
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(user => {
      if (user?.preferred_notification_time) setNotificationTime(user.preferred_notification_time);
      if (user?.notification_frequency) setNotificationFrequency(user.notification_frequency);
      if (user?.quiet_hours_start) setQuietHoursStart(user.quiet_hours_start);
      if (user?.quiet_hours_end) setQuietHoursEnd(user.quiet_hours_end);
      if (user?.quiet_hours_enabled !== undefined) setQuietHoursEnabled(user.quiet_hours_enabled);
    }).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        preferred_notification_time: notificationTime,
        notification_frequency: notificationFrequency,
        quiet_hours_enabled: quietHoursEnabled,
        quiet_hours_start: quietHoursStart,
        quiet_hours_end: quietHoursEnd,
      });
      await base44.functions.invoke('rescheduleAllGoalNotifications', {});
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

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                    Quiet hours
                  </label>
                  <button
                    onClick={() => setQuietHoursEnabled(v => !v)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${quietHoursEnabled ? 'bg-violet-600' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${quietHoursEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                {quietHoursEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                      <input
                        type="time"
                        value={quietHoursStart}
                        onChange={e => setQuietHoursStart(e.target.value)}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                      <input
                        type="time"
                        value={quietHoursEnd}
                        onChange={e => setQuietHoursEnd(e.target.value)}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
                      />
                    </div>
                  </div>
                )}
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  No notifications will be sent during this window.
                </p>
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