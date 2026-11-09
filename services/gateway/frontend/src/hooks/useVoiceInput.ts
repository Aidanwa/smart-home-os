// services/gateway/frontend/src/hooks/useVoiceInput.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

interface UseVoiceInputProps {
  onTranscription: (text: string) => void;
}

// Speech detection. The level is the RMS of the waveform (0–1), sampled on a timer:
// requestAnimationFrame pauses when the screen locks or the tab is hidden, which used
// to leave recordings running forever.
const TICK_MS = 100;
const CALIBRATE_MS = 500;      // the first half-second measures the room's background noise
const SILENCE_AFTER_MS = 1500; // stop this long after speech ends
const NO_SPEECH_MS = 8000;     // give up if nobody speaks
const MAX_MS = 60000;          // hard cap on a recording
const MIN_SPEECH_LEVEL = 0.02; // a quiet room is ~0.002–0.01; speech is well above

export function useVoiceInput({ onTranscription }: UseVoiceInputProps) {
  const { authenticatedFetch } = useAuth();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const discard = useRef(false); // true: stop without uploading
  const onTranscriptionRef = useRef(onTranscription);
  useEffect(() => { onTranscriptionRef.current = onTranscription; });

  const stopRecording = useCallback((opts?: { discard?: boolean }) => {
    discard.current = !!opts?.discard;
    setIsListening(false);
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    if (audioContext.current) {
      audioContext.current.close().catch(() => {});
      audioContext.current = null;
    }
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
  }, []);

  // Leaving the Agent tab mid-recording drops the recording and frees the microphone.
  useEffect(() => () => stopRecording({ discard: true }), [stopRecording]);

  const processAudioUpload = async (blob: Blob) => {
    setIsProcessing(true);
    const formData = new FormData();
    // Safari records mp4, others webm; the agent's ffmpeg reads either.
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    formData.append('audio_file', blob, `recording.${ext}`);

    try {
      const res = await authenticatedFetch('/api/agent/voice', { method: 'POST', body: formData });
      if (res.status === 401) return; // AuthContext logs out
      if (!res.ok) {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          toast.error('Voice isn’t ready yet', { description: 'The assistant is starting up. Try again in a minute.' });
        } else {
          toast.error('Couldn’t transcribe that', { description: 'Try again.' });
        }
        return;
      }
      const data = await res.json();
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (text) onTranscriptionRef.current(text);
      else toast('Didn’t catch anything', { description: 'Tap the mic and try again.' });
    } catch {
      toast.error('Couldn’t transcribe that', { description: 'Can’t reach the hub. Check your connection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const startListening = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone not available', { description: 'The browser only allows the microphone on HTTPS pages.' });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Microphone access denied:', err);
      return;
    }

    discard.current = false;
    audioChunks.current = [];
    setIsListening(true);

    const ctx = new AudioContext();
    audioContext.current = ctx;
    // iOS can hand back a suspended context, which reads as silence forever.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const startedAt = Date.now();
    const calibration: number[] = [];
    let speakLevel = MIN_SPEECH_LEVEL;
    let quietLevel = MIN_SPEECH_LEVEL / 2;
    let hasSpoken = false;
    let quietSince: number | null = null;

    ticker.current = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const level = Math.sqrt(sum / samples.length);
      const now = Date.now();
      const elapsed = now - startedAt;

      if (elapsed < CALIBRATE_MS) {
        calibration.push(level);
        return;
      }
      if (calibration.length) {
        // Thresholds relative to the room, so a TV or fan doesn't count as speech forever.
        const floor = calibration.sort((a, b) => a - b)[Math.floor(calibration.length / 2)];
        speakLevel = Math.max(MIN_SPEECH_LEVEL, floor * 2.5);
        quietLevel = Math.max(MIN_SPEECH_LEVEL / 2, (floor + speakLevel) / 2);
        calibration.length = 0;
      }

      if (level > speakLevel) {
        hasSpoken = true;
        quietSince = null;
      } else if (hasSpoken && level < quietLevel) {
        quietSince ??= now;
        if (now - quietSince >= SILENCE_AFTER_MS) stopRecording();
      }

      if (!hasSpoken && elapsed >= NO_SPEECH_MS) {
        stopRecording({ discard: true });
        toast('Didn’t hear anything', { description: 'Tap the mic and try again.' });
      } else if (elapsed >= MAX_MS) {
        stopRecording();
      }
    }, TICK_MS);

    const recorder = new MediaRecorder(stream);
    mediaRecorder.current = recorder;
    recorder.ondataavailable = (e) => audioChunks.current.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorder.current = null;
      if (discard.current) return;
      await processAudioUpload(new Blob(audioChunks.current, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.start();
  };

  return { isListening, isProcessing, startListening, stopRecording: () => stopRecording() };
}
