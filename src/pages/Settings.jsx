import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  Sun, 
  Moon, 
  Sparkles, 
  Settings as SettingsIcon,
  Bell,
  Shield,
  HelpCircle,
  Bug,
  LogOut,
  ArrowLeft,
  User as UserIcon
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';

export default function Settings() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const [specialMode, setSpecialMode] = useState(() => localStorage.getItem('special_mode') || 'normal');
  const [user, setUser] = useState(null);
  const [notificationTime, setNotificationTime] = useState('10:00');
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [showKey, setShowKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      if (currentUser?.preferred_notification_time) {
        setNotificationTime(currentUser.preferred_notification_time);
      }
      // Load theme from user profile (persists across devices)
      if (currentUser?.theme) {
        setTheme(currentUser.theme);
        localStorage.setItem('adhd_theme', currentUser.theme);
      }
      if (currentUser?.special_mode) {
        setSpecialMode(currentUser.special_mode);
        localStorage.setItem('special_mode', currentUser.special_mode);
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const saveNotificationTime = async () => {
    setIsSavingTime(true);
    try {
      await base44.auth.updateMe({ preferred_notification_time: notificationTime });
      // Reschedule all notifications with the new time
      await base44.functions.invoke('rescheduleAllGoalNotifications', {});
    } catch (error) {
      console.error('Error saving notification time:', error);
    } finally {
      setIsSavingTime(false);
    }
  };

  const saveOpenaiKey = async () => {
    setIsSavingKey(true);
    try {
      localStorage.setItem('openai_api_key', openaiKey);
    } catch (error) {
      console.error('Error saving OpenAI key:', error);
    } finally {
      setIsSavingKey(false);
    }
  };

  const saveThemeToProfile = async (newTheme, newSpecialMode) => {
    try {
      await base44.auth.updateMe({ theme: newTheme, special_mode: newSpecialMode });
    } catch (e) {
      console.error('Failed to save theme to profile:', e);
    }
  };

  const toggleTheme = () => {
    const currentSpecialMode = specialMode;
    if (currentSpecialMode !== 'normal') {
      localStorage.setItem('special_mode', 'normal');
      localStorage.setItem('adhd_theme', 'minimalist');
      setSpecialMode('normal');
      setTheme('minimalist');
      saveThemeToProfile('minimalist', 'normal');
      setTimeout(() => window.location.reload(), 100);
      return;
    }

    if (theme === 'spicybrains') {
      const seasonal = getDateBasedMode();
      localStorage.setItem('special_mode', seasonal);
      setSpecialMode(seasonal);
      saveThemeToProfile('spicybrains', seasonal);
      setTimeout(() => window.location.reload(), 100);
      return;
    }

    setTheme(prev => {
      let nextTheme;
      if (prev === 'minimalist') {
        nextTheme = 'dark';
      } else if (prev === 'dark') {
        nextTheme = 'colorful';
      } else if (prev === 'colorful') {
        nextTheme = 'spicybrains';
      } else {
        nextTheme = 'minimalist';
      }
      localStorage.setItem('adhd_theme', nextTheme);
      saveThemeToProfile(nextTheme, 'normal');
      return nextTheme;
    });
  };

  const getDateBasedMode = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    if (month === 12 && day >= 20 && day <= 26) return 'christmas';
    if ((month === 12 && day >= 27) || (month === 1 && day <= 5)) return 'newyears';
    if (month === 2 && day >= 10 && day <= 16) return 'valentines';
    if (month === 3 && day >= 10 && day <= 20) return 'stpatricks';
    if (month === 7 && day >= 1 && day <= 7) return 'fourthjuly';
    if ((month === 10 && day >= 25) || (month === 11 && day <= 5)) return 'halloween';
    if ((month === 3 && day >= 21) || month === 4 || month === 5) return 'spring';
    if (month === 6 || (month === 7 && day > 7) || month === 8) return 'summer';
    if (month === 9 || (month === 10 && day <= 24) || (month === 11 && day >= 6)) return 'fall';
    if (month === 12 && day <= 19) return 'winter';
    if ((month === 1 && day >= 6) || (month === 2 && (day < 10 || day > 16)) || (month === 3 && day < 10)) return 'winter';

    return 'normal';
  };

  const handleLogout = async () => {
    try {
      await base44.auth.logout();
      window.location.reload();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const settingsItems = [
    {
      icon: UserIcon,
      label: 'My Profile',
      onClick: () => navigate('/profile')
    },
    {
      icon: Bell,
      label: 'Notifications',
      onClick: () => navigate('/notificationsettings')
    },
    {
      icon: Shield,
      label: 'Privacy Policy',
      onClick: () => navigate('/privacypolicy')
    },
    {
      icon: Shield,
      label: 'Terms & Conditions',
      onClick: () => navigate('/termsandconditions')
    },
    {
      icon: Bug,
      label: 'Feedback',
      onClick: () => navigate('/reportbug')
    },
    {
      icon: Shield,
      label: 'Delete Account or Data',
      onClick: () => navigate('/deleteaccount'),
      danger: true
    }
  ];

  return (
    <div className={`min-h-screen p-4 md:p-8 ${
      theme === 'dark' ? 'bg-gray-900' : theme === 'spicybrains' ? 'bg-gradient-to-br from-pink-300 to-yellow-300' : 'bg-gradient-to-br from-stone-50 via-sage-50 to-stone-100'
    }`} style={{ paddingBottom: 'max(2rem, calc(2rem + env(safe-area-inset-bottom)))' }}>
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="gap-2 p-3 h-12 text-base rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </Button>

        <div className="mb-8">
          <h1 className={`text-3xl font-bold mb-2 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            Settings
          </h1>
          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Customize your experience
          </p>
        </div>

        {/* Notification Settings */}
        <Card className={`mb-6 border-none shadow-lg ${
          theme === 'dark' ? 'bg-gray-800' : 'bg-white'
        }`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${theme === 'dark' ? 'text-white' : ''}`}>
              <Bell className="w-5 h-5" />
              Notification Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              What time should we send you daily goal reminders?
            </p>
            <div className="flex gap-2 items-end">
              <input
                type="time"
                value={notificationTime}
                onChange={(e) => setNotificationTime(e.target.value)}
                className={`flex-1 px-4 py-2.5 rounded-lg border ${
                  theme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-white'
                    : 'bg-white border-gray-300'
                }`}
              />
              <Button
                onClick={saveNotificationTime}
                disabled={isSavingTime}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2"
              >
                {isSavingTime ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              This will apply to new goals and update reminders when you change this setting.
            </p>
          </CardContent>
        </Card>

        {/* Theme Section */}
        <Card className={`mb-6 border-none shadow-lg ${
          theme === 'dark' ? 'bg-gray-800' : 'bg-white'
        }`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${theme === 'dark' ? 'text-white' : ''}`}>
              <Sparkles className="w-5 h-5" />
              Theme
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              onClick={toggleTheme}
              className={`w-full flex items-center justify-center gap-2 py-6 rounded-lg text-base ${
                theme === 'minimalist'
                  ? 'bg-green-600 hover:bg-green-700'
                  : theme === 'dark'
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : theme === 'spicybrains'
                      ? 'bg-gradient-to-r from-pink-500 to-yellow-500 hover:from-pink-600 hover:to-yellow-600'
                      : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
              }`}
            >
              {theme === 'minimalist' ? (
                <>
                  <Sun className="w-5 h-5" />
                  Light Theme
                </>
              ) : theme === 'dark' ? (
                <>
                  <Moon className="w-5 h-5" />
                  Dark Theme
                </>
              ) : theme === 'spicybrains' ? (
                <>
                  <Sparkles className="w-5 h-5" />
                  Spicy Brains ✨
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Colorful Theme
                </>
              )}
            </Button>
            <p className={`text-xs mt-3 text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Click to cycle through themes
            </p>
          </CardContent>
        </Card>

        {/* Account Settings */}
        <Card className={`mb-6 border-none shadow-lg ${
          theme === 'dark' ? 'bg-gray-800' : 'bg-white'
        }`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${theme === 'dark' ? 'text-white' : ''}`}>
              <SettingsIcon className="w-5 h-5" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {settingsItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <Button
                  key={idx}
                  onClick={item.onClick}
                  variant="outline"
                  className={`w-full flex items-center justify-start gap-3 py-6 px-4 rounded-lg text-base ${
                    theme === 'dark' 
                      ? 'bg-gray-700 border-gray-600 hover:bg-gray-600 text-white' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${item.danger ? 'text-red-500' : ''}`} />
                  <span className={item.danger ? 'text-red-500' : ''}>{item.label}</span>
                </Button>
              );
            })}
          </CardContent>
        </Card>

        {/* Logout */}
        <Card className={`border-none shadow-lg ${
          theme === 'dark' ? 'bg-gray-800' : 'bg-white'
        }`}>
          <CardContent className="pt-6">
            <Button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-6 bg-red-600 hover:bg-red-700 text-white rounded-lg text-base"
            >
              <LogOut className="w-5 h-5" />
              Log Out
            </Button>
          </CardContent>
        </Card>

        <div style={{ height: '80px' }} aria-hidden="true" />
      </div>
    </div>
  );
}