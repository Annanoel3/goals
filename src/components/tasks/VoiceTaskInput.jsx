import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Capacitor } from '@capacitor/core';
import { hasAudioPermission, requestAudioPermission, startNativeRecording, stopNativeRecording } from '@/lib/voiceRecorder';

export default function VoiceTaskInput({ onTranscription, theme, inline = true }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const startRecording = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const hasPermission = await hasAudioPermission();
        if (!hasPermission) {
          const granted = await requestAudioPermission();
          if (!granted) return;
        }
        await startNativeRecording();
        setIsRecording(true);
      } else {
        // Web fallback
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = async () => {
          const audioBlob = new Blob(chunks, { type: mimeType });
          stream.getTracks().forEach(t => t.stop());
          if (audioBlob.size === 0) return;
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const audioFile = new File([audioBlob], `recording.${ext}`, { type: mimeType });
          await transcribeAudio(audioFile);
        };
        recorder.start();
        window._webRecorderVoiceInput = recorder;
        setIsRecording(true);
      }
    } catch (error) {
      console.error('[VOICE INPUT] Error starting recording:', error);
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const recording = await stopNativeRecording();
        const { recordDataBase64, mimeType } = recording;
        const byteChars = atob(recordDataBase64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const ext = mimeType.includes('aac') ? 'aac' : mimeType.includes('mp4') ? 'mp4' : 'webm';
        const audioFile = new File([byteArr], `recording.${ext}`, { type: mimeType });
        await transcribeAudio(audioFile);
      } catch (error) {
        console.error('[VOICE INPUT] Stop recording error:', error);
      }
    } else {
      if (window._webRecorderVoiceInput && window._webRecorderVoiceInput.state !== 'inactive') {
        window._webRecorderVoiceInput.stop();
      }
    }
  };

  const transcribeAudio = async (audioFile) => {
    setIsProcessing(true);
    try {
      const uploadResult = await base44.integrations.Core.UploadFile({ file: audioFile });
      if (!uploadResult?.file_url) throw new Error('Failed to upload audio file');

      const result = await base44.functions.invoke('transcribeAudio', { file_url: uploadResult.file_url });
      const responseData = result?.data || result;

      if (responseData?.success && responseData?.transcription) {
        await onTranscription(responseData.transcription);
      } else {
        const errorMsg = responseData?.error || "Failed to transcribe audio. Please try again.";
        alert(errorMsg);
      }
    } catch (error) {
      console.error('[VOICE INPUT] Error transcribing audio:', error);
      alert(error.message || "Failed to transcribe audio. Please try again.");
    }
    setIsProcessing(false);
  };

  if (inline) {
    return (
      <Button
        type="button"
        size="icon"
        variant={isRecording ? "destructive" : "outline"}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}
        className="flex-shrink-0"
      >
        {isProcessing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isRecording ? (
          <Square className="w-4 h-4" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="lg"
      variant={isRecording ? "destructive" : "default"}
      onClick={isRecording ? stopRecording : startRecording}
      disabled={isProcessing}
      className={`w-full ${
        theme === 'colorful'
          ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
          : 'bg-purple-600 hover:bg-purple-700'
      }`}
    >
      {isProcessing ? (
        <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Processing...</>
      ) : isRecording ? (
        <><Square className="w-5 h-5 mr-2" />Stop Recording</>
      ) : (
        <><Mic className="w-5 h-5 mr-2" />Tap to Speak</>
      )}
    </Button>
  );
}