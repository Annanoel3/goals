import { Capacitor } from '@capacitor/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';

export async function hasAudioPermission() {
  if (!Capacitor.isNativePlatform()) return false;
  const { value } = await VoiceRecorder.hasAudioRecordingPermission();
  return value;
}

export async function requestAudioPermission() {
  if (!Capacitor.isNativePlatform()) return false;
  const { value } = await VoiceRecorder.requestAudioRecordingPermission();
  return value;
}

export async function startNativeRecording() {
  await VoiceRecorder.startRecording();
}

export async function stopNativeRecording() {
  const result = await VoiceRecorder.stopRecording();
  return result.value; // { recordDataBase64, mimeType, msDuration }
}