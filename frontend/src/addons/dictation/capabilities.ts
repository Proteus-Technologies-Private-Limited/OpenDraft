import { getOS, hidesOtherMobilePlatforms, isTauri } from '../../services/platform';
import { browserRecognitionConstructor } from './services/recognition';
import type { Engine } from './settings';
import { t } from '../../i18n';
/** The engine's name for the writer. Resolved at call time so it follows the interface language. */
export function engineName(engine: Engine): string {
  switch (engine) {
    case 'browser': return t('addons:dictation.engine.browser');
    case 'device': return t('addons:dictation.engine.device');
    default: return t('addons:dictation.engine.local');
  }
}
/** What leaves the device for this engine. */
export function enginePrivacy(engine: Engine): string {
  switch (engine) {
    case 'browser': return t('addons:dictation.privacy.browser');
    // The Apple wording leaves Android out: App Review rejects an iOS build
    // that names it (guideline 2.3.10), and iOS only ever reaches Apple anyway.
    case 'device': return hidesOtherMobilePlatforms()
      ? t('addons:dictation.privacy.deviceApple')
      : t('addons:dictation.privacy.device');
    default: return t('addons:dictation.privacy.local');
  }
}
export function localCaptureProblem(): string | null {
  if (typeof window !== 'undefined' && isTauri() && getOS() === 'linux')
    return t('addons:dictation.problem.linux');
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  )
    return t('addons:dictation.problem.noMicrophone');
  return null;
}
export function availableEngines(): Engine[] {
  const native = typeof window !== 'undefined' && isTauri();
  const os = typeof navigator !== 'undefined' ? getOS() : 'unknown';
  if (native && os === 'android') return ['device'];
  const engines: Engine[] = [];
  if (
    !localCaptureProblem() &&
    typeof Worker !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  )
    engines.push('local');
  if (!native && typeof window !== 'undefined' && browserRecognitionConstructor())
    engines.push('browser');
  if (native && os === 'ios') engines.push('device');
  return engines;
}
