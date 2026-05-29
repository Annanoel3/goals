import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Mic, Square, Loader2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { Task } from "@/entities/Task";
import { ParkingLotIdea } from "@/entities/ParkingLotIdea";
import { User } from "@/entities/User";
import { scheduleReminder } from "../utils/reminderScheduler";
import { Capacitor } from '@capacitor/core';
import { hasAudioPermission, requestAudioPermission, startNativeRecording, stopNativeRecording } from '@/lib/voiceRecorder';
import { setUserActive } from '@/lib/admob';

export default function UniversalVoiceAssistant({ theme, currentPageName }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setFeedbackMessage("");
    };
    window.addEventListener('open-voice-assistant', handleOpen);
    return () => window.removeEventListener('open-voice-assistant', handleOpen);
  }, []);

  const startRecording = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const hasPermission = await hasAudioPermission();
        if (!hasPermission) {
          const granted = await requestAudioPermission();
          if (!granted) {
            setFeedbackMessage("❌ Microphone permission denied");
            return;
          }
        }
        await startNativeRecording();
      } else {
        // Web fallback using MediaRecorder
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
          if (audioBlob.size === 0) { setIsRecording(false); return; }
          setIsRecording(false);
          const audioFile = new File([audioBlob], `voice-${Date.now()}.webm`, { type: mimeType });
          await handleTranscription(audioFile);
        };
        recorder.start();
        window._webRecorder = recorder;
      }
      setIsRecording(true);
      setUserActive(true);
    } catch (error) {
      console.error("Microphone error:", error);
      setFeedbackMessage("❌ Could not access microphone");
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setUserActive(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const recording = await stopNativeRecording();
        const { recordDataBase64, mimeType } = recording;
        // Convert base64 to File
        const byteChars = atob(recordDataBase64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const ext = mimeType.includes('aac') ? 'aac' : mimeType.includes('mp4') ? 'mp4' : 'webm';
        const audioFile = new File([byteArr], `voice-${Date.now()}.${ext}`, { type: mimeType });
        await handleTranscription(audioFile);
      } catch (error) {
        console.error("Stop recording error:", error);
        setFeedbackMessage("❌ Failed to process recording");
      }
    } else {
      if (window._webRecorder && window._webRecorder.state !== 'inactive') {
        window._webRecorder.stop();
      }
    }
  };

  const handleTranscription = async (audioFile) => {
    setIsProcessing(true);
    setProcessingMessage("🎤 Converting speech to text...");
    try {
      // Convert file to base64 for transcription
      const buffer = await audioFile.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      const binaryString = Array.from(uint8Array).map(b => String.fromCharCode(b)).join('');
      const audio_base64 = btoa(binaryString);

      setProcessingMessage("⏳ Transcribing...");
      const response = await base44.functions.invoke('transcribeAudioNew', { 
        audio_base64, 
        filename: audioFile.name 
      });
      if (response?.data?.text) {
        setProcessingMessage("🤔 Understanding your request...");
        await processVoiceCommand(response.data.text);
      } else {
        throw new Error('Transcription failed');
      }
    } catch (error) {
      console.error("Transcription error:", error);
      setFeedbackMessage("❌ Failed to process voice");
      setIsProcessing(false);
    }
  };

  const processVoiceCommand = async (command) => {
    const lowerCommand = command.toLowerCase();

    // Navigation commands
    if (lowerCommand.includes('go to') || lowerCommand.includes('open') || lowerCommand.includes('show me')) {
      const pages = {
        'home': 'Home', 'tasks': 'Tasks', 'task': 'Tasks', 'focus': 'FocusTimer',
        'timer': 'FocusTimer', 'support': 'SupportSpace', 'parking lot': 'ParkingLot',
        'ideas': 'ParkingLot', 'progress': 'Progress', 'insights': 'Insights',
        'accountability': 'Accountability', 'partners': 'Accountability',
        'leaderboard': 'Leaderboard', 'profile': 'Profile', 'settings': 'ProfileSettings'
      };
      for (const [keyword, page] of Object.entries(pages)) {
        if (lowerCommand.includes(keyword)) {
          setFeedbackMessage(`✅ Opening ${keyword}...`);
          setIsProcessing(false);
          setTimeout(() => { setIsOpen(false); navigate(createPageUrl(page)); }, 1000);
          return;
        }
      }
    }

    // Task creation
    if (lowerCommand.includes('remind me') || lowerCommand.includes('create a task') ||
        lowerCommand.includes('add a task') || lowerCommand.includes('make a task') ||
        lowerCommand.includes('new task')) {

      setIsProcessing(true);
      setProcessingMessage("Creating your task...");
      try {
        const user = await User.me();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const prompt = `Extract task details from: "${command}"
Current context:
- Current time: ${now.toLocaleTimeString()}
- Today: ${today.toISOString().split('T')[0]}
- Tomorrow: ${tomorrow.toISOString().split('T')[0]}

CRITICAL: Keep ALL important details in the task title. Only remove filler words.
Return JSON:
{
  "title": "complete task description",
  "relative_minutes": number or null,
  "reminder_interval": "10min" | "20min" | "30min" | "1hour" | "2hours" | "daily" | "every_other_day" | "once" | null,
  "reminder_time": "HH:MM" or null,
  "specific_date": "YYYY-MM-DD" or null,
  "urgency": "low" | "medium" | "high" | "urgent",
  "energy_required": "low" | "medium" | "high"
}`;

        const result = await base44.functions.invoke('extractTaskFromVoice', { prompt });
        const taskData = result?.data?.taskData;
        let nextReminderTime = null;

        if (taskData.relative_minutes && taskData.relative_minutes > 0) {
          nextReminderTime = new Date(now.getTime() + taskData.relative_minutes * 60 * 1000);
        } else if (taskData.reminder_time) {
          const [hours, minutes] = taskData.reminder_time.split(':');
          if (taskData.specific_date) {
            nextReminderTime = new Date(taskData.specific_date);
            nextReminderTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          } else {
            nextReminderTime = new Date();
            nextReminderTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            if (nextReminderTime <= new Date()) nextReminderTime.setDate(nextReminderTime.getDate() + 1);
          }
        } else if (taskData.reminder_interval && taskData.reminder_interval !== 'once') {
          nextReminderTime = new Date(now.getTime());
          const intervalMap = { '10min': 10, '20min': 20, '30min': 30 };
          const hourMap = { '1hour': 1, '2hours': 2 };
          if (intervalMap[taskData.reminder_interval]) {
            nextReminderTime.setMinutes(nextReminderTime.getMinutes() + intervalMap[taskData.reminder_interval]);
          } else if (hourMap[taskData.reminder_interval]) {
            nextReminderTime.setHours(nextReminderTime.getHours() + hourMap[taskData.reminder_interval]);
          } else if (taskData.reminder_interval === 'daily') {
            nextReminderTime.setDate(nextReminderTime.getDate() + 1);
          } else if (taskData.reminder_interval === 'every_other_day') {
            nextReminderTime.setDate(nextReminderTime.getDate() + 2);
          }
        }

        const createdTask = await Task.create({
          title: taskData.title,
          urgency: taskData.urgency || 'medium',
          energy_required: taskData.energy_required || 'medium',
          status: 'active',
          reminder_interval: taskData.reminder_interval || null,
          reminder_count: 0,
          next_reminder: nextReminderTime ? nextReminderTime.toISOString() : null
        });

        if (nextReminderTime) {
          try {
            await scheduleReminder({
              email: user.email,
              title: "Task Reminder 📋",
              body: createdTask.title,
              sendAtISO: nextReminderTime.toISOString(),
              taskId: createdTask.id,
              data: { screen: "/Tasks", taskId: createdTask.id, urgency: createdTask.urgency, type: 'task_reminder' }
            });
          } catch (error) {
            console.error("Failed to schedule reminder:", error);
          }
        }

        setFeedbackMessage(`✅ Created: "${taskData.title}"`);
        setIsProcessing(false);
        setTimeout(() => { window.location.reload(); }, 1500);
        return;
      } catch (error) {
        console.error("Error creating task:", error);
        setFeedbackMessage("❌ Failed to create task");
        setIsProcessing(false);
        return;
      }
    }

    // Parking lot idea
    if (lowerCommand.includes('save this idea') || lowerCommand.includes('parking lot') ||
        lowerCommand.includes('remember this')) {
      setIsProcessing(true);
      setProcessingMessage("Saving idea...");
      try {
        const ideaText = command.replace(/save this idea|parking lot|remember this/gi, '').trim();
        await ParkingLotIdea.create({ idea: ideaText, converted_to_task: false });
        setFeedbackMessage("✅ Idea saved to parking lot!");
        setIsProcessing(false);
        setTimeout(() => { setIsOpen(false); navigate(createPageUrl("ParkingLot")); }, 1500);
        return;
      } catch (error) {
        console.error("Error saving idea:", error);
        setFeedbackMessage("❌ Failed to save idea");
        setIsProcessing(false);
        return;
      }
    }

    setFeedbackMessage("❓ I didn't quite catch that. Try:\n• 'Remind me to...'\n• 'Go to tasks'\n• 'Save this idea...'");
    setIsProcessing(false);
  };

  const handleClose = () => {
    if (isRecording) stopRecording();
    setIsOpen(false);
    setFeedbackMessage("");
    setProcessingMessage("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={`max-w-md ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
        <div className="flex flex-col items-center justify-center p-6 space-y-6">
          <Button size="icon" variant="ghost" onClick={handleClose} className="absolute top-4 right-4">
            <X className="w-5 h-5" />
          </Button>

          <div className={`w-24 h-24 rounded-full flex items-center justify-center ${
            isRecording ? 'bg-red-500 animate-pulse'
              : isProcessing ? 'bg-blue-500'
              : theme === 'colorful' ? 'bg-gradient-to-br from-purple-600 to-pink-600'
              : 'bg-purple-600'
          }`}>
            {isProcessing ? (
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            ) : (
              <Mic className={`w-12 h-12 text-white ${isRecording ? 'animate-pulse' : ''}`} />
            )}
          </div>

          <div className="text-center">
            <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              {isProcessing ? processingMessage : isRecording ? "Listening..." : "Voice Assistant"}
            </h3>
            {feedbackMessage ? (
              <p className={`text-sm whitespace-pre-line ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                {feedbackMessage}
              </p>
            ) : (
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                {isRecording ? "Tap to stop recording" : "Tap to start speaking"}
              </p>
            )}
          </div>

          {!isProcessing && (
            <Button
              size="lg"
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-full ${
                isRecording ? 'bg-red-600 hover:bg-red-700'
                  : theme === 'colorful' ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {isRecording ? (
                <><Square className="w-5 h-5 mr-2" />Stop Recording</>
              ) : (
                <><Mic className="w-5 h-5 mr-2" />Start Recording</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}