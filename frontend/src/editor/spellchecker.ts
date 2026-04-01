// @ts-ignore — typo-js has no type declarations
import Typo from 'typo-js';

class SpellChecker {
  private typo: Typo | null = null;
  private customWords: Set<string> = new Set();
  private ignoreWords: Set<string> = new Set(); // session-only
  private ready = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // On mobile Tauri, dictionaries are not served — skip spell check
      const { isMobileTauri } = await import('../services/platform');
      if (isMobileTauri()) {
        console.log('SpellChecker: skipped on mobile (no dictionary server)');
        return;
      }

      const [affResponse, dicResponse] = await Promise.all([
        fetch('/dictionaries/en_US.aff'),
        fetch('/dictionaries/en_US.dic'),
      ]);

      if (!affResponse.ok || !dicResponse.ok) {
        console.error('SpellChecker: failed to load dictionary files —',
          'aff:', affResponse.status, 'dic:', dicResponse.status);
        return;
      }

      const [affData, dicData] = await Promise.all([
        affResponse.text(),
        dicResponse.text(),
      ]);

      // Sanity check: .aff must start with SET, .dic must start with word count
      if (!affData.startsWith('SET') || !/^\d+/.test(dicData)) {
        console.error('SpellChecker: dictionary data appears corrupt (got HTML or empty response?)');
        return;
      }

      this.typo = new Typo('en_US', affData, dicData);
      // Load custom dictionary from localStorage
      const stored = localStorage.getItem('opendraft:customDictionary');
      if (stored) {
        try {
          (JSON.parse(stored) as string[]).forEach((w: string) =>
            this.customWords.add(w),
          );
        } catch {
          // ignore corrupt data
        }
      }
      this.ready = true;
    } catch (err) {
      console.error('SpellChecker: initialization failed', err);
    }
  }

  /** Wait for initialization to complete (if in progress). */
  async whenReady(): Promise<boolean> {
    if (this.ready) return true;
    if (this.initPromise) {
      await this.initPromise;
    }
    return this.ready;
  }

  isReady(): boolean {
    return this.ready;
  }

  check(word: string): boolean {
    if (!this.typo) return true;
    if (this.customWords.has(word.toLowerCase())) return true;
    if (this.ignoreWords.has(word.toLowerCase())) return true;
    return this.typo.check(word) as boolean;
  }

  suggest(word: string): string[] {
    if (!this.typo) return [];
    return this.typo.suggest(word, 5) as string[];
  }

  addToCustomDictionary(word: string): void {
    this.customWords.add(word.toLowerCase());
    localStorage.setItem(
      'opendraft:customDictionary',
      JSON.stringify([...this.customWords]),
    );
  }

  ignoreWord(word: string): void {
    this.ignoreWords.add(word.toLowerCase());
  }

  /** Collect all misspelled words with their positions from a ProseMirror doc. */
  findAllErrors(doc: import('@tiptap/pm/state').EditorState['doc']): { word: string; from: number; to: number; context: string }[] {
    const errors: { word: string; from: number; to: number; context: string }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = node.text || '';
      const wordRegex = /[a-zA-Z\u00C0-\u024F']+/g;
      let match: RegExpExecArray | null;
      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[0];
        if (word.length < 2) continue;
        if (word === word.toUpperCase() && word.length > 1) continue;
        if (!this.check(word)) {
          const from = pos + match.index;
          const to = from + word.length;
          // Build context: up to 30 chars around the word
          const ctxStart = Math.max(0, match.index - 15);
          const ctxEnd = Math.min(text.length, match.index + word.length + 15);
          const context = (ctxStart > 0 ? '...' : '') + text.slice(ctxStart, ctxEnd) + (ctxEnd < text.length ? '...' : '');
          errors.push({ word, from, to, context });
        }
      }
    });
    return errors;
  }
}

export const spellChecker = new SpellChecker();
