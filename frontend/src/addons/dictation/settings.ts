/** Device-only preferences. Never included in scripts or collaboration. */
export type Engine = 'local' | 'browser' | 'device';
export interface DictationSettings { engine: Engine; language: string; commands: boolean }
const KEY = 'opendraft:addon:dictation';
export const DEFAULT_SETTINGS: DictationSettings = { engine: 'local', language: 'en', commands: false };
export function loadSettings(): DictationSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      engine: ['local', 'browser', 'device'].includes(saved.engine) ? saved.engine : 'local',
      language: typeof saved.language === 'string' && /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(saved.language) ? saved.language : 'en',
      commands: saved.commands === true,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: DictationSettings): void { localStorage.setItem(KEY, JSON.stringify(settings)); }
export function forgetSettings(): void { localStorage.removeItem(KEY); }
