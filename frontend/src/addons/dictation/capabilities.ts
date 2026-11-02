import { getOS, isTauri } from '../../services/platform';
import { browserRecognitionConstructor } from './services/recognition';
import type { Engine } from './settings';
export const ENGINE_NAMES: Record<Engine, string> = {
  local: 'Local Whisper', browser: 'Browser speech service', device: 'Device speech service',
};
export const ENGINE_PRIVACY: Record<Engine, string> = {
  local: 'Audio stays on this device. First use downloads model assets from huggingface.co, which sees your IP address.',
  browser: 'Your recorded voice may be sent to the browser vendor’s speech servers (Google, Apple or Microsoft).',
  device: 'Your recorded voice may be sent to Apple or your Android speech provider (usually Google). On-device recognition is requested where supported; an offline preference is not a guarantee.',
};
export function localCaptureProblem(): string | null {
  if (typeof window !== 'undefined' && isTauri() && getOS() === 'linux')
    return 'This Linux desktop build does not expose supported WebKit microphone capture. Use OpenDraft in a microphone-capable browser for Local Whisper.';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    return 'Microphone recording is unavailable in this browser. Use HTTPS or localhost and enable microphone access.';
  return null;
}
export function availableEngines(): Engine[] {
  const native = typeof window !== 'undefined' && isTauri();
  const os = typeof navigator !== 'undefined' ? getOS() : 'unknown';
  if (native && os === 'android') return ['device'];
  const engines: Engine[] = [];
  if (!localCaptureProblem() && typeof Worker !== 'undefined' && typeof AudioContext !== 'undefined') engines.push('local');
  if (typeof window !== 'undefined' && browserRecognitionConstructor()) engines.push('browser');
  if (native && os === 'ios') engines.push('device');
  return engines;
}
