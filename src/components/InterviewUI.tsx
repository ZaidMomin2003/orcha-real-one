'use client';

import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
} from '@google/genai';
// FIX: Imported `React` to make the React namespace available for types like `React.ChangeEvent`.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createBlob, decode, decodeAudioData } from '@/lib/utils';
import Visualizer3D from './Visualizer3D';

const voices = [
  { name: 'Orus (Male)', value: 'Orus', description: 'Deep, authoritative, and warm.' },
  { name: 'Zephyr (Male)', value: 'Zephyr', description: 'Calm, smooth, and reassuring.' },
  { name: 'Puck (Male)', value: 'Puck', description: 'Playful, bright, and energetic.' },
  { name: 'Charon (Male)', value: 'Charon', description: 'Gravelly, wise, and mysterious.' },
  { name: 'Kore (Female)', value: 'Kore', description: 'Warm, friendly, and clear.' },
  { name: 'Fenrir (Male)', value: 'Fenrir', description: 'Strong, commanding, and resonant.' },
];

export default function InterviewUI() {
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [status, setStatus] = useState('Click the mic to start your interview');
  const [error, setError] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Orus');
  const [currentUserTranscription, setCurrentUserTranscription] = useState('');
  const [currentAiTranscription, setCurrentAiTranscription] = useState('');
  const [inputNode, setInputNode] = useState<GainNode | null>(null);
  const [outputNode, setOutputNode] = useState<GainNode | null>(null);

  const userVideoEl = useRef<HTMLVideoElement>(null);
  const sessionPromiseRef = useRef<Promise<Session> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const clientRef = useRef<GoogleGenAI | null>(null);

  const updateStatus = (msg: string) => {
    setStatus(msg);
    setError('');
  };

  const updateError = (msg: string) => {
    setError(msg);
  };

  const stopAllPlayback = useCallback(() => {
    if (!outputAudioContextRef.current) return;
    for (const source of sourcesRef.current.values()) {
      source.stop();
      sourcesRef.current.delete(source);
    }
    nextStartTimeRef.current = 0;
  }, []);

  const playAudio = useCallback(async (base64EncodedAudioString: string) => {
    if (!outputAudioContextRef.current || !outputNode) return;
    nextStartTimeRef.current = Math.max(
      nextStartTimeRef.current,
      outputAudioContextRef.current.currentTime
    );
    const audioBuffer = await decodeAudioData(
      decode(base64EncodedAudioString),
      outputAudioContextRef.current,
      24000,
      1
    );
    const source = outputAudioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputNode);
    source.addEventListener('ended', () => {
      sourcesRef.current.delete(source);
    });
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
    sourcesRef.current.add(source);
  }, [outputNode]);

  const initSession = useCallback(() => {
    if (!clientRef.current) return;
    try {
      sessionPromiseRef.current = clientRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => updateStatus('Session Opened. Ready for interview.'),
          onmessage: async (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) playAudio(audio.data);
            if (message.serverContent?.interrupted) stopAllPlayback();
            if (message.serverContent?.outputTranscription) {
              setCurrentAiTranscription(prev => prev + message.serverContent.outputTranscription.text);
            }
            if (message.serverContent?.inputTranscription) {
              setCurrentUserTranscription(prev => prev + message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.turnComplete) {
              setCurrentUserTranscription('');
              setCurrentAiTranscription('');
            }
          },
          onerror: (e: ErrorEvent) => updateError(e.message),
          onclose: (e: CloseEvent) => updateStatus('Session Closed: ' + e.reason),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are an expert interviewer for a senior frontend engineer position at Google. Ask me challenging technical and behavioral questions. Start with a brief introduction and then begin the interview. Keep your responses concise and professional.',
        },
      });
      sessionPromiseRef.current.catch((e) => {
        console.error(e);
        updateError(e.message);
      });
    } catch (e: any) {
      console.error(e);
      updateError(e.message);
    }
  }, [selectedVoice, playAudio, stopAllPlayback]);
  
  const reset = useCallback(() => {
    stopAllPlayback();
    sessionPromiseRef.current?.then((session) => session.close());
    initSession();
    updateStatus('Session Reset. Ready for a new interview.');
  }, [initSession, stopAllPlayback]);

  useEffect(() => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
    outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

    const inNode = inputAudioContextRef.current.createGain();
    const outNode = outputAudioContextRef.current.createGain();
    outNode.connect(outputAudioContextRef.current.destination);

    setInputNode(inNode);
    setOutputNode(outNode);
    
    clientRef.current = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_API_KEY! });
    initSession();

    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      sessionPromiseRef.current?.then((session) => session.close());
      inputAudioContextRef.current?.close();
      outputAudioContextRef.current?.close();
    };
  }, [initSession]);

  const startInterview = async () => {
    if (isInterviewing) return;

    await inputAudioContextRef.current?.resume();
    updateStatus('Requesting device access...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      mediaStreamRef.current = stream;

      if (userVideoEl.current) {
        userVideoEl.current.srcObject = stream;
        userVideoEl.current.play();
      }

      updateStatus('Access granted. Starting...');
      
      const inputCtx = inputAudioContextRef.current!;
      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);
      sourceNodeRef.current.connect(inputNode!);

      const bufferSize = 4096;
      scriptProcessorNodeRef.current = inputCtx.createScriptProcessor(bufferSize, 1, 1);

      scriptProcessorNodeRef.current.onaudioprocess = (audioProcessingEvent) => {
        if (!isInterviewing) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        sessionPromiseRef.current?.then((session) => {
          session.sendRealtimeInput({ media: createBlob(pcmData) });
        });
      };

      sourceNodeRef.current.connect(scriptProcessorNodeRef.current);
      scriptProcessorNodeRef.current.connect(inputCtx.destination);

      setIsInterviewing(true);
      updateStatus('🔴 Interview in progress...');
    } catch (err: any) {
      console.error('Error starting interview:', err);
      updateStatus(`Error: ${err.message}`);
      stopInterview();
    }
  };

  const stopInterview = () => {
    if (!isInterviewing && !mediaStreamRef.current) return;

    updateStatus('Interview ended.');
    setIsInterviewing(false);

    scriptProcessorNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    
    if (userVideoEl.current) {
      userVideoEl.current.srcObject = null;
    }

    reset();
  };

  const onVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVoice(e.target.value);
    reset();
  };

  const captionText = currentAiTranscription || currentUserTranscription;

  return (
    <div className="meet-layout">
      <div id="status">{error || status}</div>
      <div className="main-view">
        {inputNode && outputNode && (
            <Visualizer3D inputNode={inputNode} outputNode={outputNode} />
        )}
        <video id="user-video" className={isInterviewing ? 'active' : ''} ref={userVideoEl} muted></video>
        <div className={`captions-overlay ${captionText ? 'active' : ''}`}>
          {currentAiTranscription
            ? <><b>Interviewer:</b> {currentAiTranscription}</>
            : <><b>You:</b> {currentUserTranscription}</>
          }
        </div>
      </div>
      <div className="control-bar">
        <select id="voiceSelect" onChange={onVoiceChange} value={selectedVoice} disabled={isInterviewing} aria-label="Select Interviewer Voice">
          {voices.map((voice) => (
            <option key={voice.value} value={voice.value} title={voice.description}>
              {voice.name}
            </option>
          ))}
        </select>
        <button onClick={startInterview} disabled={isInterviewing} aria-label="Start Interview">
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M480-400q-50 0-85-35t-35-85v-200q0-50 35-85t85-35q50 0 85 35t35 85v200q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T520-520v-200q0-17-11.5-28.5T480-760q-17 0-28.5 11.5T440-720v200q0 17 11.5 28.5T480-480Zm0 320q-139-12-234.5-116T150-520v-100q0-25 17.5-42.5T210-680h40q25 0 42.5 17.5T310-620v100q0 83 58.5 141.5T510-320h20q83 0 141.5-58.5T730-520v-100q0-25 17.5-42.5T790-680h40q25 0 42.5 17.5T890-620v100q0 131-95.5 235T560-160v80h-80v-80Z"/></svg>
        </button>
        <button className="end-call" onClick={stopInterview} disabled={!isInterviewing} aria-label="End Interview">
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m336-280-56-56 144-144-144-144 56-56 144 144 144-144 56 56-144 144 144 144-56 56-144-144-144 144Z"/></svg>
        </button>
      </div>
    </div>
  );
}
