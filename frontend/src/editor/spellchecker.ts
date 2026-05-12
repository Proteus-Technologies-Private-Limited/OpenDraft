// @ts-ignore — typo-js has no type declarations
import Typo from 'typo-js';

/** Listener invoked when the dictionary contents change (project words, global
 *  library, enabled set). Used to trigger an editor rescan. */
type DictChangeListener = () => void;

class SpellChecker {
  private typo: Typo | null = null;
  /** Words the user added via "Add to dictionary" — per-project, saved with the script. */
  private projectWords: Set<string> = new Set();
  /** Global named dictionaries (e.g. "Personal", "Sci-Fi"). Shared across projects, lives in localStorage. */
  private globalDicts: Map<string, Set<string>> = new Map();
  /** Names of global dictionaries the current project has enabled. */
  private enabledGlobalDicts: Set<string> = new Set();
  private ignoreWords: Set<string> = new Set(); // ignore all occurrences (per-document)
  private ignoredOnce: Set<string> = new Set(); // ignore specific occurrences (per-document)
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private listeners: Set<DictChangeListener> = new Set();

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
    // Normalize curly apostrophes to straight so contractions like "doesn't"
    // typed with smart quotes match Hunspell's dictionary entries.
    const normalized = word.replace(/[‘’]/g, "'");
    const lower = normalized.toLowerCase();
    if (this.projectWords.has(lower)) return true;
    if (this.ignoreWords.has(lower)) return true;
    for (const name of this.enabledGlobalDicts) {
      const dict = this.globalDicts.get(name);
      if (dict && dict.has(lower)) return true;
    }
    return this.typo.check(normalized) as boolean;
  }

  /** Check if a specific occurrence is ignored via "Ignore Once". */
  isIgnoredOnce(word: string, contextKey: string): boolean {
    return this.ignoredOnce.has(`${word.toLowerCase()}|${contextKey}`);
  }

  suggest(word: string): string[] {
    if (!this.typo) return [];
    return this.typo.suggest(word, 5) as string[];
  }

  /** Add a word to the current project's private dictionary. Persisted with the script. */
  addToProjectDictionary(word: string): void {
    this.projectWords.add(word.toLowerCase());
    this.emitChange();
  }

  /** Remove a word from the current project's private dictionary. */
  removeFromProjectDictionary(word: string): void {
    if (this.projectWords.delete(word.toLowerCase())) {
      this.emitChange();
    }
  }

  /** Return project private dictionary words (for persisting with the document). */
  getProjectWords(): string[] {
    return [...this.projectWords].sort();
  }

  /** Bulk-load project private words (when opening a document). */
  setProjectWords(words: string[]): void {
    this.projectWords.clear();
    for (const w of words) this.projectWords.add(w.toLowerCase());
    this.emitChange();
  }

  /** Names of global dictionaries currently enabled for the active project. */
  getEnabledGlobalDicts(): string[] {
    return [...this.enabledGlobalDicts].sort();
  }

  /** Bulk-set the enabled global dictionaries for the active project. */
  setEnabledGlobalDicts(names: string[]): void {
    this.enabledGlobalDicts.clear();
    for (const n of names) this.enabledGlobalDicts.add(n);
    this.emitChange();
  }

  /** Replace the global dictionary library (called by the store on any library change). */
  setGlobalDictionaries(dicts: Record<string, readonly string[]>): void {
    this.globalDicts.clear();
    for (const [name, words] of Object.entries(dicts)) {
      this.globalDicts.set(name, new Set(words.map((w) => w.toLowerCase())));
    }
    this.emitChange();
  }

  /** Subscribe to dictionary-content changes. Returns an unsubscribe fn. */
  onChange(listener: DictChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emitChange(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch (err) { console.warn('SpellChecker listener threw', err); }
    }
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

  /** Collect all misspelled words with their positions from a ProseMirror doc.
   *  @param flagProperNouns When false (default), capitalized unknown words are
   *  treated as proper nouns and skipped. When true, they are flagged. */
  findAllErrors(
    doc: import('@tiptap/pm/state').EditorState['doc'],
    flagProperNouns: boolean = false,
  ): { word: string; from: number; to: number; context: string; contextKey: string }[] {
    const errors: { word: string; from: number; to: number; context: string; contextKey: string }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = node.text || '';
      const wordRegex = /[a-zA-Z\u00C0-\u024F'\u2018\u2019]+/g;
      let match: RegExpExecArray | null;
      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[0];
        if (word.length < 2) continue;
        if (word === word.toUpperCase() && word.length > 1) continue;
        if (!this.check(word)) {
          if (!flagProperNouns && /^\p{Lu}/u.test(word)) continue;
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
