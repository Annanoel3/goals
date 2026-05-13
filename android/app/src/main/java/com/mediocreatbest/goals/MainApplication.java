package com.mediocreatbest.goals;

import android.app.Application;

import com.onesignal.OneSignal;
import com.onesignal.debug.LogLevel;

public class MainApplication extends Application {

    // OneSignal App ID for ADHDone
    private static final String ONESIGNAL_APP_ID = "969fa1ea-0e85-4ac0-b122-015f5957dd30";

    @Override
    public void onCreate() {
        super.onCreate();

        // Enable verbose logging only for debug builds
        if (BuildConfig.DEBUG) {
            OneSignal.getDebug().setLogLevel(LogLevel.VERBOSE);
        }

        // Initialize OneSignal
        // NOTE: Always initialize in Application class, not MainActivity
        OneSignal.initWithContext(this, ONESIGNAL_APP_ID);

        // NOTE: Do NOT call requestPermission() here — it causes a NullPointerException
        // due to missing coroutine context. Call it from the web app via
        // NotifyBridge.requestPermission() instead.
    }
}
