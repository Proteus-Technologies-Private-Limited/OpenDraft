/** Android owns queue advancement. Polling reconciles the UI only; it is safe
 * to suspend this WebView between polls or between two spoken lines. */
import { getOS, isTauri } from '../platform';
import { t } from '../../i18n';

export interface BackgroundLine { text: string; voice: string | null; rate: number; pitch: number; gap: number }
export interface BackgroundState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  index?: number;
  offset?: number;
  end?: number;
  owned?: boolean;
  session?: string;
}
type Request = (request: Record<string, unknown>) => Promise<BackgroundState>;
const nativeRequest: Request = async (request) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('tts_table_read', { request });
};
export const hasAndroidBackgroundRead = () => isTauri() && getOS() === 'android';
export const backgroundReadError = () => t('messages:tts.backgroundStopped');
export const releaseAndroidBackgroundRead = () => nativeRequest({ action: 'release' });

export class AndroidBackgroundRead {
  private readonly session = crypto.randomUUID();
  private disposed = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private lastState = '';
  private readonly refresh = () => { void this.poll(); };
  private readonly onState: (state: BackgroundState) => void;
  private readonly request: Request;
  constructor(onState: (state: BackgroundState) => void, request: Request = nativeRequest) {
    this.onState = onState;
    this.request = request;
  }

  private send(action: string, extra: Record<string, unknown> = {}): Promise<BackgroundState> {
    const next = this.chain.catch(() => {}).then(() => this.request({ ...extra, action, session: this.session }));
    this.chain = next;
    return next;
  }

  async start(lines: BackgroundLine[], index: number, offset: number): Promise<void> {
    const labels = {
      title: t('tools:tableRead.title'), play: t('tools:tableRead.play'), pause: t('tools:tableRead.pause'),
      stop: t('tools:tableRead.stop'), next: t('tools:tableRead.nextLine'), previous: t('tools:tableRead.previousLine'),
    };
    const state = await this.send('start', { lines, index, offset, labels });
    if (this.disposed) return;
    this.publish(state);
    if (this.disposed) return;
    this.timer = setInterval(this.refresh, 200);
    document.addEventListener('visibilitychange', this.refresh);
    window.addEventListener('focus', this.refresh);
  }

  async command(action: 'play' | 'pause' | 'stop' | 'jump', index?: number): Promise<void> {
    await this.send(action, index === undefined ? {} : { index });
    await this.poll();
  }

  private async poll() {
    if (this.disposed || this.busy || document.visibilityState === 'hidden') return;
    this.busy = true;
    try {
      const state = await this.send('snapshot');
      if (!this.disposed) this.publish(state);
    } catch {
      if (!this.disposed) this.onState({ status: 'error' });
    } finally { this.busy = false; }
  }

  private publish(state: BackgroundState) {
    const key = JSON.stringify(state);
    if (key === this.lastState || (state.session && state.session !== this.session)) return;
    this.lastState = key;
    this.onState(state);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.refresh);
    window.removeEventListener('focus', this.refresh);
    void this.send('stop').catch(() => {});
  }
}
