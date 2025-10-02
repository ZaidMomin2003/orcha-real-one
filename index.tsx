/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isInterviewing = false;
  @state() status = 'Click the mic to start your interview';
  @state() error = '';
  @state() selectedVoice = 'Orus';
  @state() currentUserTranscription = '';
  @state() currentAiTranscription = '';

  @query('#user-video') private userVideoEl!: HTMLVideoElement;

  private readonly voices = [
    {
      name: 'Orus (Male)',
      value: 'Orus',
      description: 'Deep, authoritative, and warm.',
    },
    {
      name: 'Zephyr (Male)',
      value: 'Zephyr',
      description: 'Calm, smooth, and reassuring.',
    },
    {
      name: 'Puck (Male)',
      value: 'Puck',
      description: 'Playful, bright, and energetic.',
    },
    {
      name: 'Charon (Male)',
      value: 'Charon',
      description: 'Gravelly, wise, and mysterious.',
    },
    {
      name: 'Kore (Female)',
      value: 'Kore',
      description: 'Warm, friendly, and clear.',
    },
    {
      name: 'Fenrir (Male)',
      value: 'Fenrir',
      description: 'Strong, commanding, and resonant.',
    },
  ];

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session>;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      --gdm-icon-color: white;
      --gdm-button-background-color: #3c4043;
      --gdm-button-background-color-hover: #52565a;
      --gdm-end-call-button-background-color: #ea4335;
      --gdm-end-call-button-background-color-hover: #f28b82;
      font-family: 'Google Sans', sans-serif;
    }

    .meet-layout {
      width: 100vw;
      height: 100vh;
      background-color: #202124;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }

    .main-view {
      flex-grow: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    gdm-live-audio-visuals-3d {
      width: 100%;
      height: 100%;
    }

    #user-video {
      position: absolute;
      bottom: 100px;
      right: 20px;
      width: 240px;
      height: 180px;
      border: 2px solid #5f6368;
      border-radius: 8px;
      object-fit: cover;
      transform: scaleX(-1); /* Mirror effect */
      background-color: #000;
      display: none; /* Hidden by default */
    }

    #user-video.active {
      display: block;
    }

    .captions-overlay {
      position: absolute;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      max-width: 80%;
      text-align: center;
      font-size: 1.2rem;
      visibility: hidden;
    }

    .captions-overlay.active {
      visibility: visible;
    }

    .control-bar {
      height: 80px;
      background-color: #202124;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 0 1rem;
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
    }

    .control-bar button {
      background-color: var(--gdm-button-background-color);
      border: none;
      border-radius: 50%;
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .control-bar button:hover {
      background-color: var(--gdm-button-background-color-hover);
    }

    .control-bar button.end-call {
      background-color: var(--gdm-end-call-button-background-color);
    }
    .control-bar button.end-call:hover {
      background-color: var(--gdm-end-call-button-background-color-hover);
    }

    .control-bar button svg {
      fill: var(--gdm-icon-color);
    }

    .control-bar button[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    select {
      outline: none;
      border: 1px solid var(--gdm-button-background-color);
      color: white;
      border-radius: 25px;
      background: var(--gdm-button-background-color);
      padding: 10px 15px;
      width: 150px;
      font-size: 1rem;
      cursor: pointer;
      text-align: center;
    }

    select:hover {
      background: var(--gdm-button-background-color-hover);
    }

    select:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    select option {
      background: #100c14;
      color: white;
    }

    #status {
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: #bdc1c6;
      background-color: rgba(0, 0, 0, 0.5);
      padding: 8px 16px;
      border-radius: 16px;
      z-index: 10;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    try {
      this.sessionPromise = this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Session Opened. Ready for interview.');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.playAudio(audio.data);
            }
            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              this.stopAllPlayback();
            }

            // Handle transcriptions
            if (message.serverContent?.outputTranscription) {
              this.currentAiTranscription +=
                message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.inputTranscription) {
              this.currentUserTranscription +=
                message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              // Reset for the next turn
              this.currentUserTranscription = '';
              this.currentAiTranscription = '';
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session Closed: ' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {voiceName: this.selectedVoice},
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction:
            'You are an expert interviewer for a senior frontend engineer position at Google. Ask me challenging technical and behavioral questions. Start with a brief introduction and then begin the interview. Keep your responses concise and professional.',
        },
      });

      this.sessionPromise.catch((e) => {
        console.error(e);
        this.updateError(e.message);
      });
    } catch (e) {
      console.error(e);
      this.updateError(e.message);
    }
  }

  private async playAudio(base64EncodedAudioString: string) {
    this.nextStartTime = Math.max(
      this.nextStartTime,
      this.outputAudioContext.currentTime,
    );
    const audioBuffer = await decodeAudioData(
      decode(base64EncodedAudioString),
      this.outputAudioContext,
      24000,
      1,
    );
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode);
    source.addEventListener('ended', () => {
      this.sources.delete(source);
    });
    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.sources.add(source);
  }

  private stopAllPlayback() {
    for (const source of this.sources.values()) {
      source.stop();
      this.sources.delete(source);
    }
    this.nextStartTime = 0;
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startInterview() {
    if (this.isInterviewing) return;

    await this.inputAudioContext.resume();
    this.updateStatus('Requesting device access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      this.userVideoEl.srcObject = this.mediaStream;
      this.userVideoEl.play();

      this.updateStatus('Access granted. Starting...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isInterviewing) return;
        const pcmData =
          audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isInterviewing = true;
      this.updateStatus('🔴 Interview in progress...');
    } catch (err) {
      console.error('Error starting interview:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopInterview();
    }
  }

  private stopInterview() {
    if (!this.isInterviewing && !this.mediaStream) return;

    this.updateStatus('Interview ended.');
    this.isInterviewing = false;

    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.userVideoEl) {
      this.userVideoEl.srcObject = null;
    }

    this.reset();
  }



  private reset() {
    this.stopAllPlayback();
    this.sessionPromise?.then((session) => session.close());
    this.initSession();
    this.updateStatus('Session Reset. Ready for a new interview.');
  }

  private onVoiceChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.selectedVoice = select.value;
    this.reset();
  }

  render() {
    const captionText =
      this.currentAiTranscription || this.currentUserTranscription;
    return html`
      <div class="meet-layout">
        <div id="status">${this.error || this.status}</div>

        <div class="main-view">
          <gdm-live-audio-visuals-3d
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}>
          </gdm-live-audio-visuals-3d>

          <video
            id="user-video"
            class=${this.isInterviewing ? 'active' : ''}
            muted></video>

          <div
            class="captions-overlay ${captionText ? 'active' : ''}">
            ${this.currentAiTranscription
              ? html`<b>Interviewer:</b> ${this.currentAiTranscription}`
              : html`<b>You:</b> ${this.currentUserTranscription}`}
          </div>
        </div>

        <div class="control-bar">
          <select
            id="voiceSelect"
            @change=${this.onVoiceChange}
            .value=${this.selectedVoice}
            ?disabled=${this.isInterviewing}
            aria-label="Select Interviewer Voice">
            ${this.voices.map(
              (voice) =>
                html`<option value=${voice.value} title=${voice.description}>
                  ${voice.name}
                </option>`,
            )}
          </select>

          <button
            @click=${this.startInterview}
            ?disabled=${this.isInterviewing}
            aria-label="Start Interview">
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M480-400q-50 0-85-35t-35-85v-200q0-50 35-85t85-35q50 0 85 35t35 85v200q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T520-520v-200q0-17-11.5-28.5T480-760q-17 0-28.5 11.5T440-720v200q0 17 11.5 28.5T480-480Zm0 320q-139-12-234.5-116T150-520v-100q0-25 17.5-42.5T210-680h40q25 0 42.5 17.5T310-620v100q0 83 58.5 141.5T510-320h20q83 0 141.5-58.5T730-520v-100q0-25 17.5-42.5T790-680h40q25 0 42.5 17.5T890-620v100q0 131-95.5 235T560-160v80h-80v-80Z"/></svg>
          </button>

          <button class="end-call" @click=${this.stopInterview} ?disabled=${!this.isInterviewing} aria-label="End Interview">
             <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m336-280-56-56 144-144-144-144 56-56 144 144 144-144 56 56-144 144 144 144-56 56-144-144-144 144Z"/></svg>
          </button>
        </div>
      </div>
    `;
  }
}
