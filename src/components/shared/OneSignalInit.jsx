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

  // Goal-related notifications → show in-app popup with Go to Goal / Go to Chat
  if (screen === 'GoalStepNotification' || data.action === 'goal_plan_nudge' || data.goal_id) {
    window.dispatchEvent(new CustomEvent('show-notification-popup', {
      detail: {
        goal_id: data.goal_id,
        action: data.action,
        step_id: data.step_id,
        title: data._title,
        body: data._body,
        nudge_message: data.nudge_message,
      }
    }));
    return;
  }

  // Task notifications → keep existing behavior
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
          if (data) {
            data._title = event?.notification?.title;
            data._body = event?.notification?.body;
          }
          handleNotificationData(data, navigate);
        });
        // Also check for launch notification
        NotifyBridge.getLaunchNotification?.().then((result) => {
          if (result?.notification?.data) {
            const data = result.notification.data;
            data._title = result.notification?.title;
            data._body = result.notification?.body;
            handleNotificationData(data, navigate);
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
              appId: "969fa1ea-0e85-4ac0-b122-015f5957dd30",
              allowLocalhostAsSecureOrigin: true
            });

            console.log('[OneSignal] ✅ Web SDK using login() with:', externalId);
            window.OneSignal.login(externalId);

            // Handle notification clicks in web
            window.OneSignal.Notifications.addEventListener('click', (event) => {
              const data = event?.notification?.data;
              const actionId = event?.actionSelected || event?.actionId;
              if (actionId && data && data.step_id) { handleButtonAction(actionId, data); return; }
              if (data) {
                data._title = event?.notification?.title || event?.notification?.heading;
                data._body = event?.notification?.body || event?.notification?.content;
              }
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