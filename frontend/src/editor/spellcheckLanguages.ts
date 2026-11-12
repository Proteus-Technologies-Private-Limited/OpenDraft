import { spellChecker } from './spellchecker';

/** State used by both the quick menu and Dictionary Settings. */
export type LanguageChecker = Pick<typeof spellChecker,
  'getEnabledLanguages' | 'getLoadedLanguages' | 'setEnabledLanguages' | 'getDocumentGeneration' | 'onChange' | 'onDocumentChange'>;

export function canDisableLanguage(code: string, enabled: readonly string[], loaded: ReadonlySet<string>): boolean {
  return !enabled.includes(code) || !loaded.has(code) || enabled.filter(language => loaded.has(language)).length > 1;
}

type Result = { status: 'enabled' | 'disabled' | 'unchanged' | 'blocked' | 'installed' }
  | { status: 'failed'; error?: string };
interface Options {
  checker?: LanguageChecker;
  install?: (code: string) => Promise<{ ok: boolean; error?: string }>;
  isCurrent?: () => boolean;
}

/** Only enabling may install. Re-read state after I/O; never reuse a render snapshot. */
export async function setScriptLanguageEnabled(code: string, on: boolean, {
  checker = spellChecker, install, isCurrent = () => true,
}: Options = {}): Promise<Result> {
  const generation = checker.getDocumentGeneration();
  if (on && !checker.getLoadedLanguages().some(language => language.code === code)) {
    if (!install) return { status: 'failed' };
    const result = await install(code);
    if (!result.ok) return { status: 'failed', error: result.error };
    if (checker.getDocumentGeneration() !== generation || !isCurrent()) return { status: 'installed' };
    if (!checker.getLoadedLanguages().some(language => language.code === code)) return { status: 'failed' };
  }
  const current = checker.getEnabledLanguages();
  if (current.includes(code) === on) return { status: 'unchanged' };
  const loaded = new Set(checker.getLoadedLanguages().map(language => language.code));
  if (!on && !canDisableLanguage(code, current, loaded)) return { status: 'blocked' };
  checker.setEnabledLanguages(on ? [...current, code] : current.filter(language => language !== code));
  return { status: on ? 'enabled' : 'disabled' };
}

/** Dictionary loads/rescans are not edits. Loading another document resets the baseline. */
export function onScriptLanguagesChange(listener: () => void, checker: LanguageChecker = spellChecker): () => void {
  let generation = checker.getDocumentGeneration();
  let previous = JSON.stringify(checker.getEnabledLanguages());
  const stopDocument = checker.onDocumentChange(() => {
    generation = checker.getDocumentGeneration();
    previous = JSON.stringify(checker.getEnabledLanguages());
  });
  const stopChange = checker.onChange(() => {
    const nextGeneration = checker.getDocumentGeneration();
    const next = JSON.stringify(checker.getEnabledLanguages());
    const changed = nextGeneration === generation && next !== previous;
    generation = nextGeneration;
    previous = next;
    if (changed) listener();
  });
  return () => { stopDocument(); stopChange(); };
}
