// services/gateway/frontend/src/hooks/useVoiceInput.ts
import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

interface UseVoiceInputProps {
  onTranscription: (text: string) => void;
}

export function useVoiceInput({ onTranscription }: UseVoiceInputProps) {
  const { authenticatedFetch } = useAuth();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // We use refs for state that needs to be read inside the animation frame loop
  const isListeningRef = useRef(false); 
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const stopRecording = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);

    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
    }
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  }, []);

  const startListening = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access blocked by the browser. You must use HTTPS or localhost.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      isListeningRef.current = true;
      setIsListening(true);
      audioChunks.current = [];

      audioContext.current = new AudioContext();
      const source = audioContext.current.createMediaStreamSource(stream);
      const analyser = audioContext.current.createAnalyser();
      analyser.minDecibels = -70; 
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      let hasSpoken = false; // Tracks if the user actually started talking

      const checkAudioLevel = () => {
        if (!isListeningRef.current) return;
        
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;

        const VOLUME_THRESHOLD = 20; // Increased to ignore laptop fan/static noise

        if (average > VOLUME_THRESHOLD) {
          // Noise detected! Clear any pending stop timers.
          hasSpoken = true;
          if (silenceTimer.current) {
            clearTimeout(silenceTimer.current);
            silenceTimer.current = null;
          }
        } else if (hasSpoken && !silenceTimer.current) {
          // User WAS speaking, but now it's quiet. Start the 1.5s countdown.
          silenceTimer.current = setTimeout(() => {
            stopRecording();
          }, 1500);
        }

        requestAnimationFrame(checkAudioLevel);
      };
      
      checkAudioLevel(); // Start the loop

      mediaRecorder.current = new MediaRecorder(stream);
      mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);
      
      mediaRecorder.current.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        await processAudioUpload(audioBlob);
      };

      mediaRecorder.current.start();
    } catch (err) {
      console.error("Microphone access denied:", err);
      isListeningRef.current = false;
      setIsListening(false);
    }
  };

  const processAudioUpload = async (blob: Blob) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append("audio_file", blob, "recording.webm");

    try {
      const res = await authenticatedFetch('/api/agent/voice', {
        method: 'POST',
        body: formData,
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          onTranscription(data.text);
        }
      }
    } catch (error) {
      console.error("Audio processing failed", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return { isListening, isProcessing, startListening, stopRecording };
}