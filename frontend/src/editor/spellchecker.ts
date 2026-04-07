// @ts-ignore — typo-js has no type declarations
import Typo from 'typo-js';

class SpellChecker {
  private typo: Typo | null = null;
  private customWords: Set<string> = new Set();
  private ignoreWords: Set<string> = new Set(); // ignore all occurrences (per-document)
  private ignoredOnce: Set<string> = new Set(); // ignore specific occurrences (per-document)
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

  /** Check if a specific occurrence is ignored via "Ignore Once". */
  isIgnoredOnce(word: string, contextKey: string): boolean {
    return this.ignoredOnce.has(`${word.toLowerCase()}|${contextKey}`);
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

  /** Ignore all occurrences of a word in this document. */
  ignoreWord(word: string): void {
    this.ignoreWords.add(word.toLowerCase());
  }

  /** Ignore a specific occurrence of a word (identified by surrounding context). */
  ignoreOnce(word: string, contextKey: string): void {
    this.ignoredOnce.add(`${word.toLowerCase()}|${contextKey}`);
  }

  /** Return all ignored words (for persisting with the document). */
  getIgnoredWords(): string[] {
    return [...this.ignoreWords];
  }

  /** Bulk-load ignored words (when opening a document). */
  setIgnoredWords(words: string[]): void {
    this.ignoreWords.clear();
    for (const w of words) {
      this.ignoreWords.add(w.toLowerCase());
    }
  }

  /** Return all ignored-once entries (for persisting with the document). */
  getIgnoredOnce(): string[] {
    return [...this.ignoredOnce];
  }

  /** Bulk-load ignored-once entries (when opening a document). */
  setIgnoredOnce(entries: string[]): void {
    this.ignoredOnce.clear();
    for (const e of entries) {
      this.ignoredOnce.add(e);
    }
  }

  /**
   * Build a context key for a word occurrence.
   * Uses up to 20 chars before + 20 chars after the word within the text node.
   * This fingerprint identifies a specific location and survives paragraph reordering.
   */
  static buildContextKey(text: string, matchIndex: number, wordLength: number): string {
    const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
    const after = text.slice(matchIndex + wordLength, matchIndex + wordLength + 20);
    return `${before}>><<${after}`;
  }

  /** Collect all misspelled words with their positions from a ProseMirror doc. */
  findAllErrors(doc: import('@tiptap/pm/state').EditorState['doc']): { word: string; from: number; to: number; context: string; contextKey: string }[] {
    const errors: { word: string; from: number; to: number; context: string; contextKey: string }[] = [];
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
          const contextKey = SpellChecker.buildContextKey(text, match.index, word.length);
          // Skip if this specific occurrence was ignored via "Ignore Once"
          if (this.isIgnoredOnce(word, contextKey)) continue;
          const from = pos + match.index;
          const to = from + word.length;
          // Build context: up to 30 chars around the word
          const ctxStart = Math.max(0, match.index - 15);
          const ctxEnd = Math.min(text.length, match.index + word.length + 15);
          const context = (ctxStart > 0 ? '...' : '') + text.slice(ctxStart, ctxEnd) + (ctxEnd < text.length ? '...' : '');
          errors.push({ word, from, to, context, contextKey });
        }
      }
    });
    return errors;
  }
}

export const spellChecker = new SpellChecker();
