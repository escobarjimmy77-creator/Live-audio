/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() showSettings = false;
  @state() selectedVoice = 'Orus';
  @state() languageCode = 'es-US';
  @state() speakingRate = 1.0;
  @state() textInputValue = '';

  private client: GoogleGenAI;
  private session: Session;
  // FIX: Cast window to `any` to allow access to `webkitAudioContext` for older browsers.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // FIX: Cast window to `any` to allow access to `webkitAudioContext` for older browsers.
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
      --glow-color: rgba(77, 208, 225, 0.7);
      --record-color: #e53935;
      --record-glow: rgba(255, 82, 82, 0.8);
      --text-color: #e0e0e0;
      --border-color: rgba(255, 255, 255, 0.2);
      --bg-blur: blur(10px);
      --transition-speed: 0.3s;
    }

    #status {
      position: absolute;
      bottom: 22vh;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      text-align: center;
      color: var(--text-color);
      font-family: sans-serif;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: var(--bg-blur);
      padding: 8px 20px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      transition: all var(--transition-speed) ease;
      opacity: 0;
      visibility: hidden;
      max-width: 80%;
    }

    #status:not(:empty) {
      opacity: 1;
      visibility: visible;
      bottom: 25vh;
    }

    #status.error {
      color: var(--record-color);
      border-color: var(--record-glow);
      box-shadow: 0 0 15px var(--record-glow);
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 20px;
    }

    .controls button {
      outline: none;
      border: 1px solid var(--border-color);
      color: var(--text-color);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: var(--bg-blur);
      width: 64px;
      height: 64px;
      cursor: pointer;
      font-size: 24px;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-speed) ease;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }

    .controls button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      box-shadow: 0 0 15px var(--glow-color), 0 0 30px var(--glow-color);
      transform: translateY(-3px) scale(1.05);
      border-color: rgba(77, 208, 225, 0.5);
    }

    .controls button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }

    .text-input-area {
      display: flex;
      gap: 15px;
      width: clamp(300px, 80%, 500px);
      align-items: center;
    }

    #text-input {
      flex-grow: 1;
      height: 56px;
      padding: 0 25px;
      border-radius: 28px;
      border: 1px solid var(--border-color);
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: var(--bg-blur);
      color: var(--text-color);
      font-size: 1.1rem;
      outline: none;
      transition: all var(--transition-speed) ease;
      box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.2);
    }

    #text-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    #text-input:focus {
      border-color: var(--glow-color);
      box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.2),
        0 0 15px var(--glow-color);
    }

    #text-input:disabled {
      opacity: 0.4;
    }

    #sendButton {
      width: 56px;
      height: 56px;
      flex-shrink: 0;
    }

    .button-row {
      display: flex;
      gap: 20px;
    }

    @keyframes pulse-record {
      0% {
        box-shadow: 0 0 0 0 var(--record-glow);
      }
      70% {
        box-shadow: 0 0 10px 20px rgba(255, 82, 82, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(255, 82, 82, 0);
      }
    }

    #recordButton.recording {
      background: var(--record-color);
      border-color: var(--record-glow);
      animation: pulse-record 2s infinite cubic-bezier(0.66, 0, 0, 1);
    }

    #recordButton.recording:hover {
      background: #ff5252;
    }

    .settings-panel {
      position: absolute;
      bottom: 25vh;
      left: 50%;
      width: 340px;
      transform: translateX(-50%) translateY(20px);
      background: rgba(30, 30, 45, 0.7);
      backdrop-filter: var(--bg-blur);
      border-radius: 16px;
      padding: 1.5rem;
      z-index: 20;
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
      color: var(--text-color);
      font-family: sans-serif;
      opacity: 0;
      visibility: hidden;
      transition: opacity var(--transition-speed) ease,
        transform var(--transition-speed) ease,
        visibility var(--transition-speed);
    }

    .settings-panel.visible {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.2rem;
    }

    .setting-item:last-child {
      margin-bottom: 0;
    }

    .settings-panel label {
      margin-right: 1rem;
    }

    .settings-panel select,
    .settings-panel input {
      background: rgba(0, 0, 0, 0.2);
      color: var(--text-color);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      padding: 10px;
      font-size: 14px;
      width: 180px;
      transition: all var(--transition-speed) ease;
    }

    .settings-panel input[type='text'] {
      width: 164px;
    }

    .settings-panel input[type='range'] {
      -webkit-appearance: none;
      appearance: none;
      width: 130px;
      height: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
      outline: none;
      padding: 0;
    }

    .settings-panel input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: var(--glow-color);
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid #1e1e1e;
    }

    .settings-panel input[type='range']::-moz-range-thumb {
      width: 18px;
      height: 18px;
      background: var(--glow-color);
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid #1e1e1e;
    }

    .settings-panel select:focus,
    .settings-panel input:focus {
      border-color: var(--glow-color);
      box-shadow: 0 0 10px var(--glow-color);
    }

    .settings-panel select {
      cursor: pointer;
    }

    .settings-panel option {
      background-color: #333;
      color: white;
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

    // FIX: The API key must be obtained from `process.env.API_KEY` as per the coding guidelines.
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    let systemInstruction =
      "You are a helpful voice assistant. Please respond in the user's language.";
    if (this.languageCode.startsWith('es-')) {
      systemInstruction =
        'Eres un asistente de voz muy útil. Por favor, responde en español.';
    } else if (this.languageCode.startsWith('fr-')) {
      systemInstruction =
        'Vous êtes un assistant vocal utile. Veuillez répondre en français.';
    } else if (this.languageCode.startsWith('de-')) {
      systemInstruction =
        'Sie sind ein hilfreicher Sprachassistent. Bitte antworten Sie auf Deutsch.';
    } else if (this.languageCode.startsWith('en-')) {
      systemInstruction =
        'You are a helpful voice assistant. Please respond in English.';
    }

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
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
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(
              'A connection error occurred. Please reset the session.',
            );
          },
          onclose: (e: CloseEvent) => {
            if (e.code === 1000) {
              this.updateStatus('Connection closed.');
            } else {
              this.updateError(
                `Connection closed unexpectedly: ${
                  e.reason || 'Unknown reason'
                } (code: ${e.code})`,
              );
            }
          },
        },
        config: {
          dialogConfig: {
            systemInstruction: systemInstruction,
          },
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.selectedVoice,
              },
              // FIX: The `speakingRate` property belongs inside `voiceConfig` to correct the type error.
              speakingRate: this.speakingRate,
            },
            languageCode: this.languageCode,
          },
        },
      });
    } catch (e) {
      this.updateError(
        'Failed to connect. Please check your network and refresh the page.',
      );
    }
  }

  private playUISound(type: 'click' | 'sent') {
    // Ensure the audio context is running, especially after user interaction
    if (this.outputAudioContext.state === 'suspended') {
      this.outputAudioContext.resume();
    }
    if (!this.outputAudioContext) return;

    const now = this.outputAudioContext.currentTime;
    const gainNode = this.outputAudioContext.createGain();
    gainNode.connect(this.outputAudioContext.destination);

    // Set initial gain to a very small value to avoid pops
    gainNode.gain.setValueAtTime(0.0001, now);

    if (type === 'click') {
      const oscillator = this.outputAudioContext.createOscillator();
      oscillator.type = 'triangle';
      oscillator.connect(gainNode);

      const peakGain = 0.08;
      gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.01);
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

      oscillator.start(now);
      oscillator.stop(now + 0.1);

      // Clean up nodes after they've finished playing
      oscillator.onended = () => {
        gainNode.disconnect();
      };
    } else if (type === 'sent') {
      const oscillator1 = this.outputAudioContext.createOscillator();
      const oscillator2 = this.outputAudioContext.createOscillator();
      oscillator1.type = 'sine';
      oscillator2.type = 'sine';
      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);

      const peakGain = 0.06;
      gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

      oscillator1.frequency.setValueAtTime(600, now);
      oscillator1.start(now);
      oscillator1.stop(now + 0.05);

      oscillator2.frequency.setValueAtTime(900, now + 0.05);
      oscillator2.start(now + 0.05);
      oscillator2.stop(now + 0.15);

      // Clean up nodes after they've finished playing
      oscillator2.onended = () => {
        gainNode.disconnect();
      };
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    console.error(`Error: ${msg}`);
    this.error = msg;
    this.status = '';
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private async startRecording() {
    this.playUISound('click');
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Microphone error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    this.playUISound('click');
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped.');
  }

  private reset() {
    this.playUISound('click');
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  private toggleSettings() {
    this.playUISound('click');
    this.showSettings = !this.showSettings;
  }

  private handleVoiceChange(e: Event) {
    this.selectedVoice = (e.target as HTMLSelectElement).value;
    if (!this.isRecording) {
      this.reset();
    }
  }

  private handleLanguageChange(e: Event) {
    this.languageCode = (e.target as HTMLSelectElement).value;
    if (!this.isRecording) {
      this.reset();
    }
  }

  private handleRateChange(e: Event) {
    this.speakingRate = parseFloat((e.target as HTMLInputElement).value);
    if (!this.isRecording) {
      this.reset();
    }
  }

  private handleTextInput(e: Event) {
    this.textInputValue = (e.target as HTMLInputElement).value;
    this.error = '';
  }

  private async sendTextMessage() {
    if (!this.textInputValue.trim() || !this.session) return;
    this.playUISound('click');
    try {
      // FIX: The `sendText` method does not exist on the `Session` object. Use `sendRealtimeInput` with a `text` payload instead.
      await this.session.sendRealtimeInput({text: this.textInputValue});
      this.textInputValue = '';
      this.playUISound('sent');
    } catch (e) {
      console.error('Error sending text message:', e);
      this.updateError('Failed to send message.');
    }
  }

  private handleTextKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.sendTextMessage();
    }
  }

  render() {
    const statusClasses = {error: !!this.error};
    const recordButtonClasses = {recording: this.isRecording};
    const settingsPanelClasses = {visible: this.showSettings};
    return html`
      <div>
        <div class="settings-panel ${classMap(settingsPanelClasses)}">
          <div class="setting-item">
            <label for="voice-select">Voice</label>
            <select
              id="voice-select"
              .value=${this.selectedVoice}
              @change=${this.handleVoiceChange}
              ?disabled=${this.isRecording}>
              <option value="Orus">Orus</option>
              <option value="Choral">Choral</option>
              <option value="Lyra">Lyra</option>
              <option value="Seraph">Seraph</option>
              <option value="Echo">Echo</option>
              <option value="Nimbus">Nimbus</option>
            </select>
          </div>
          <div class="setting-item">
            <label for="language-select">Language</label>
            <select
              id="language-select"
              .value=${this.languageCode}
              @change=${this.handleLanguageChange}
              ?disabled=${this.isRecording}>
              <option value="en-US">English (US)</option>
              <option value="es-US">Español (US)</option>
              <option value="fr-FR">Français</option>
              <option value="de-DE">Deutsch</option>
            </select>
          </div>
          <div class="setting-item">
            <label for="rate-slider"
              >Rate: ${this.speakingRate.toFixed(1)}</label
            >
            <input
              id="rate-slider"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              .value=${String(this.speakingRate)}
              @change=${this.handleRateChange}
              ?disabled=${this.isRecording} />
          </div>
        </div>

        <div class="controls">
          <div class="text-input-area">
            <input
              id="text-input"
              type="text"
              placeholder="Type a message..."
              .value=${this.textInputValue}
              @input=${this.handleTextInput}
              @keydown=${this.handleTextKeyDown}
              ?disabled=${this.isRecording}
              aria-label="Message input" />
            <button
              id="sendButton"
              @click=${this.sendTextMessage}
              ?disabled=${this.isRecording || !this.textInputValue.trim()}
              title="Send message">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#ffffff">
                <path
                  d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
              </svg>
            </button>
          </div>
          <div class="button-row">
            <button
              id="settingsButton"
              @click=${this.toggleSettings}
              ?disabled=${this.isRecording}
              title="Settings">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff">
                <path
                  d="m382-160-42-102q-17-6-33.5-15t-31.5-20l-114 48L40-480l94-68q-1-9-1.5-18.5T132-585q0-9 .5-18.5T134-622l-94-68 121-212 114 48q15-11 31.5-20t33.5-15L382-800h204l42 102q17 6 33.5 15t31.5 20l114-48 121 212-94 68q1 9 1.5 18.5t.5 18.5q0 9-.5 18.5T826-554l94 68-121 212-114-48q-15 11-31.5-20t-33.5-15L586-160H382Zm98-220q84 0 142-58t58-142q0-84-58-142t-142-58q-84 0-142 58t-58 142q0 84 58 142t142 58Z" />
              </svg>
            </button>
            <button
              id="resetButton"
              @click=${this.reset}
              ?disabled=${this.isRecording}
              title="Reset Session">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff">
                <path
                  d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
              </svg>
            </button>
            <button
              id="recordButton"
              class=${classMap(recordButtonClasses)}
              @click=${this.toggleRecording}
              title=${this.isRecording ? 'Stop Recording' : 'Start Recording'}>
              ${this.isRecording
                ? html` <svg
                    viewBox="0 0 100 100"
                    width="32px"
                    height="32px"
                    fill="#ffffff"
                    xmlns="http://www.w3.org/2000/svg">
                    <rect x="15" y="15" width="70" height="70" rx="15" />
                  </svg>`
                : html`<svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="40px"
                    viewBox="0 -960 960 960"
                    width="40px"
                    fill="#ffffff">
                    <path
                      d="M480-400q-50 0-85-35t-35-85v-200q0-50 35-85t85-35q50 0 85 35t35 85v200q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T520-520v-200q0-17-11.5-28.5T480-760q-17 0-28.5 11.5T440-720v200q0 17 11.5 28.5T480-480Zm0 280q-83 0-156-31.5T197-297q-24-24-28-58t12-65q16-31 43-50t62-25q11-105 92.5-179.5T480-720q93 0 174.5 74.5T747-466q35 6 62 25t43 50q16 31 12 65t-28 58q-54 54-127 85.5T480-200Z" />
                  </svg>`}
            </button>
          </div>
        </div>

        <div id="status" class=${classMap(statusClasses)}>
          ${this.error || this.status}
        </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}