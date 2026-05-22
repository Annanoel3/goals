import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

// Helper function to detect if running in Capacitor mobile app
function isRunningInCapacitor() {
    return window.Capacitor?.isNativePlatform?.() ?? false;
}

// Handle incoming notification data and route to the correct in-app screen
function handleNotificationData(data, navigate) {
  if (!data) return;
  const taskId = data.taskId || data.task_id;
  const screen = data.screen;

  // Goal plan nudge → open Planner with pre-loaded AI message
  if (data.action === 'goal_plan_nudge') {
    const params = new URLSearchParams();
    if (data.goal_id) params.set('nudge', data.goal_id);
    if (data.nudge_message) params.set('message', encodeURIComponent(data.nudge_message));
    navigate(`/Planner?${params.toString()}`);
    return;
  }

  // Goal step/week/month notifications
  if (screen === 'GoalStepNotification') {
    const params = new URLSearchParams();
    params.set('action', data.action || 'goal_step');
    if (data.goal_id) params.set('goal_id', data.goal_id);
    if (data.step_id) params.set('step_id', data.step_id);
    if (data.week_label) params.set('week_label', data.week_label);
    if (data.month_label) params.set('month_label', data.month_label);
    navigate(`/GoalStepNotification?${params.toString()}`);
    return;
  }

  // Task notifications
  if (taskId && (screen === '/TaskNotification' || screen === 'TaskNotification')) {
    navigate(`/TaskNotification?taskId=${taskId}`);
  }
}

async function handleButtonAction(actionId, data) {
  try {
    await base44.functions.invoke('notificationButtonAction', {
      button_id: actionId,
      step_id: data.step_id,
      goal_id: data.goal_id,
    });
  } catch (err) {
    console.error('[OneSignal] Button action failed:', err);
  }
}

export default function OneSignalInit({ user }) {
  const navigate = useNavigate();

  // Handle notification-open deep links on app launch (native: from cold start data)
  useEffect(() => {
    // Check if app was opened via a notification (Capacitor)
    if (isRunningInCapacitor()) {
      const NotifyBridge = window.Capacitor?.Plugins?.NotifyBridge;
      if (NotifyBridge) {
        NotifyBridge.addListener?.('notificationOpened', (event) => {
          const data = event?.notification?.data || event?.data;
          const actionId = event?.actionId || event?.action?.actionId;
          if (actionId && data && data.step_id) { handleButtonAction(actionId, data); return; }
          handleNotificationData(data, navigate);
        });
        // Also check for launch notification
        NotifyBridge.getLaunchNotification?.().then((result) => {
          if (result?.notification?.data) {
            handleNotificationData(result.notification.data, navigate);
          }
        }).catch(() => {});
      }
    }
  }, [navigate]);

  useEffect(() => {
    const syncOneSignal = async () => {
      if (!user) {
        console.log('[OneSignal] No user provided to OneSignalInit');
        return;
      }

      const userEmail = user?.email;

      // Use real email if available, otherwise construct a fake one from user.id
      // (OneSignal requires email format for external ID)
      let externalId;
      if (userEmail && userEmail.includes('@')) {
        externalId = userEmail;
        console.log('[OneSignal] ✅ Using real email as external ID:', externalId);
      } else if (user?.id) {
        externalId = `${user.id}@adhdone.app`;
        console.log('[OneSignal] ⚠️ No email found, using generated ID:', externalId);
      } else {
        console.error('[OneSignal] No email or user ID available, skipping');
        return;
      }

      if (isRunningInCapacitor()) {
        // Running in Capacitor native app - call NotifyBridge plugin directly
        console.log('[OneSignal] Running in Capacitor mobile app');
        const NotifyBridge = window.Capacitor?.Plugins?.NotifyBridge;

        if (!NotifyBridge) {
          console.warn('[OneSignal] NotifyBridge plugin not found');
          return;
        }

        if (externalId) {
          console.log('[OneSignal] ✅ Calling NotifyBridge.login() with:', externalId);
          await NotifyBridge.requestPermission();
          await NotifyBridge.login({ externalId: externalId });
        } else {
          console.log('[OneSignal] Calling NotifyBridge.logout()');
          await NotifyBridge.logout();
        }
      } else {
        // Running in web browser - use web SDK
        console.log('[OneSignal] Running in web browser');
        
        if (externalId) {
          // Initialize OneSignal web SDK
          window.OneSignal = window.OneSignal || [];
          window.OneSignal.push(function() {
            window.OneSignal.init({
              appId: "dc1933bc-e49e-4d8a-aa4a-2c9ca749ff37",
              allowLocalhostAsSecureOrigin: true
            });

            console.log('[OneSignal] ✅ Web SDK using login() with:', externalId);
            window.OneSignal.login(externalId);

            // Handle notification clicks in web
            window.OneSignal.Notifications.addEventListener('click', (event) => {
              const data = event?.notification?.data;
              const actionId = event?.actionSelected || event?.actionId;
              if (actionId && data && data.step_id) { handleButtonAction(actionId, data); return; }
              handleNotificationData(data, navigate);
            });
          });
        } else {
          // FIXED: Use SDK 5.x logout() method instead of deprecated removeExternalUserId()
          if (window.OneSignal) {
            window.OneSignal.push(function() {
              window.OneSignal.logout();
              console.log('[OneSignal] Web SDK logged out');
            });
          }
        }
      }
    };

    syncOneSignal();
  }, [user]);

  return null;
}