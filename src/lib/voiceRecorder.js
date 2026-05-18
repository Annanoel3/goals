import { Capacitor } from '@capacitor/core';

let _VoiceRecorder = null;

async function getVoiceRecorder() {
  if (_VoiceRecorder) return _VoiceRecorder;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import('capacitor-voice-recorder');
    _VoiceRecorder = mod.VoiceRecorder;
    return _VoiceRecorder;
  } catch {
    console.warn('[VoiceRecorder] capacitor-voice-recorder not available');
    return null;
  }
}

export async function hasAudioPermission() {
  const vr = await getVoiceRecorder();
  if (!vr) return false;
  const { value } = await vr.hasAudioRecordingPermission();
  return value;
}

export async function requestAudioPermission() {
  const vr = await getVoiceRecorder();
  if (!vr) return false;
  const { value } = await vr.requestAudioRecordingPermission();
  return value;
}

export async function startNativeRecording() {
  const vr = await getVoiceRecorder();
  if (!vr) return false;
  await vr.startRecording();
  return true;
}

export async function stopNativeRecording() {
  const vr = await getVoiceRecorder();
  if (!vr) return null;
  const result = await vr.stopRecording();
  return result.value; // { recordDataBase64, mimeType, msDuration }
}