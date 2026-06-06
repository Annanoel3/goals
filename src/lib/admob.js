import { Capacitor, registerPlugin } from '@capacitor/core';

const AD_UNIT_ID = 'ca-app-pub-7979856440890193/4527633059';
const SHOW_EVERY_N_OPENS = 3;  // Show ad every 3rd app open
const AD_DELAY_MS = 30000;     // Wait 30 seconds before showing

let AdMob = null;
let hasShownAdThisLaunch = false;
let hasInitializedAdMob = false;
let currentPageName = null;

// Global flag — set to true when user is typing or recording
let userIsActive = false;
export function setUserActive(active) { userIsActive = active; }

// Track the current page
export function setCurrentPage(pageName) { currentPageName = pageName; }

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

export async function showInterstitialAd({ skipIfShownThisLaunch = false } = {}) {
  if (skipIfShownThisLaunch && hasShownAdThisLaunch) return false;
  if (!AdMob) return false;
  try {
    await AdMob.prepareInterstitial({ adId: AD_UNIT_ID, isTesting: false });
    await AdMob.showInterstitial();
    hasShownAdThisLaunch = true;
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

  // Only show ad every 3rd open, skip if on Planner page
  if (count % SHOW_EVERY_N_OPENS === 0) {
    // If on Planner page, skip showing ad (set flag to retry on next page)
    if (currentPageName === 'Planner') {
      hasShownAdThisLaunch = false;
      return;
    }

    await new Promise(resolve => setTimeout(resolve, AD_DELAY_MS));
    // Don't interrupt if the user is actively typing or recording
    if (userIsActive) return;
    // If user navigated to Planner during the delay, skip
    if (currentPageName === 'Planner') return;
    await showInterstitialAd();
    hasShownAdThisLaunch = true;
  }
}