import { Capacitor, registerPlugin } from '@capacitor/core';

const AD_UNIT_ID = 'ca-app-pub-7979856440890193/4527633059';
const SHOW_EVERY_N_OPENS = 3;  // Show ad every 3rd app open
const AD_DELAY_MS = 30000;     // Wait 10 seconds before showing

let AdMob = null;
let hasShownAdThisLaunch = false;
let hasInitializedAdMob = false;

// Global flag — set to true when user is typing or recording
let userIsActive = false;
export function setUserActive(active) { userIsActive = active; }

export async function initAdMob() {
  if (hasInitializedAdMob) return;
  hasInitializedAdMob = true;

  if (!Capacitor.isNativePlatform()) return;
  try {
    AdMob = registerPlugin('AdMob');
    await AdMob.initialize({ initializeForTesting: false });
    console.log('[AdMob] initialized');
  } catch (e) {
    console.warn('[AdMob] init failed:', e);
    AdMob = null;
  }
}

export async function showInterstitialAd() {
  if (!AdMob) return false;
  try {
    await AdMob.prepareInterstitial({ adId: AD_UNIT_ID, isTesting: false });
    await AdMob.showInterstitial();
    return true;
  } catch (e) {
    console.warn('[AdMob] interstitial failed:', e);
    return false;
  }
}

export async function maybeShowAdOnOpen() {
  if (hasShownAdThisLaunch) return;
  hasShownAdThisLaunch = true;

  const count = parseInt(localStorage.getItem('app_open_count') || '0');

  if (count % SHOW_EVERY_N_OPENS === 0) {
    await new Promise(resolve => setTimeout(resolve, AD_DELAY_MS));
    // Don't interrupt if the user is actively typing or recording
    if (userIsActive) return;
    await showInterstitialAd();
  }
}