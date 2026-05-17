// @ts-ignore — typo-js has no type declarations
import Typo from 'typo-js';

/** Listener invoked when the dictionary contents change (project words, global
 *  library, enabled set, languages, add-targets). Triggers an editor rescan. */
type DictChangeListener = () => void;

/** Special add-target id meaning "the project's private dictionary". */
export const PROJECT_DICT_TARGET = '__project__';

/** Storage key for downloaded dictionary blobs (IndexedDB object store). */
const DICT_DB_NAME = 'opendraft-dictionaries';
const DICT_STORE = 'languages';
const DICT_DB_VERSION = 1;

interface StoredLanguageBlob {
  code: string;
  aff: string;
  dic: string;
  // human-readable label captured at install time (e.g. "Hindi")
  label?: string;
  // jsdelivr/wooorm npm package this came from, if any
  source?: string;
}

/** Minimal IndexedDB helper for storing downloaded .aff/.dic. Stays internal. */
async function openDictDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DICT_DB_NAME, DICT_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DICT_STORE)) {
          db.createObjectStore(DICT_STORE, { keyPath: 'code' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbGet(code: string): Promise<StoredLanguageBlob | null> {
  const db = await openDictDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DICT_STORE, 'readonly');
      const req = tx.objectStore(DICT_STORE).get(code);
      req.onsuccess = () => resolve((req.result as StoredLanguageBlob) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbPut(blob: StoredLanguageBlob): Promise<void> {
  const db = await openDictDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      tx.objectStore(DICT_STORE).put(blob);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function dbDelete(code: string): Promise<void> {
  const db = await openDictDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      tx.objectStore(DICT_STORE).delete(code);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function dbList(): Promise<StoredLanguageBlob[]> {
  const db = await openDictDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DICT_STORE, 'readonly');
      const req = tx.objectStore(DICT_STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredLanguageBlob[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Built-in language always available (bundled in /public/dictionaries/). */
export const BUILTIN_LANGUAGE = 'en_US';

class SpellChecker {
  /** Hunspell engines keyed by language code (e.g. "en_US", "hi"). */
  private typos: Map<string, Typo> = new Map();
  /** Labels captured for each loaded language (display only). */
  private labels: Map<string, string> = new Map();
  /** Languages active for the current document (set per-script). */
  private enabledLanguages: Set<string> = new Set([BUILTIN_LANGUAGE]);

  /** Words the user added via "Add to dictionary" — per-project, saved with the script. */
  private projectWords: Set<string> = new Set();
  /** When false, project words are skipped during checks (per-script toggle). */
  private projectDictionaryEnabled: boolean = true;

  /** Global named dictionaries (e.g. "Personal", "Sci-Fi"). Shared across projects, lives in localStorage. */
  private globalDicts: Map<string, Set<string>> = new Map();
  /** Names of global dictionaries the current project has enabled. */
  private enabledGlobalDicts: Set<string> = new Set();

  /** Dictionaries that the "Add to Dictionary" action writes to. Members are
   *  either PROJECT_DICT_TARGET or a global-dict name. Global setting. */
  private addTargets: Set<string> = new Set([PROJECT_DICT_TARGET]);

  private ignoreWords: Set<string> = new Set(); // ignore all occurrences (per-document)
  private ignoredOnce: Set<string> = new Set(); // ignore specific occurrences (per-document)

  /** True once the built-in language is loaded. */
  private ready = false;
  private initPromise: Promise<void> | null = null;
  /** Per-language load promises (de-dupes concurrent loadLanguage calls). */
  private loadPromises: Map<string, Promise<boolean>> = new Map();
  private listeners: Set<DictChangeListener> = new Set();

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const ok = await this.loadLanguage(BUILTIN_LANGUAGE, { label: 'English (US)' });
    if (!ok) {
      console.error('SpellChecker: failed to load built-in language', BUILTIN_LANGUAGE);
      return;
    }
    this.ready = true;

    // Re-hydrate any languages the user had previously installed via download.
    try {
      const installed = await dbList();
      for (const blob of installed) {
        if (blob.code === BUILTIN_LANGUAGE) continue;
        try {
          this.typos.set(blob.code, new Typo(blob.code, blob.aff, blob.dic));
          if (blob.label) this.labels.set(blob.code, blob.label);
        } catch (err) {
          console.warn('SpellChecker: failed to instantiate cached language', blob.code, err);
        }
      }
      this.emitChange();
    } catch (err) {
      console.warn('SpellChecker: could not re-hydrate installed languages', err);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Language loading

  /** Load a language. Tries bundled `/dictionaries/<code>.aff/.dic` first,
   *  then IndexedDB cache, then jsdelivr (wooorm/dictionaries). */
  async loadLanguage(
    code: string,
    opts?: { affUrl?: string; dicUrl?: string; label?: string; persist?: boolean },
  ): Promise<boolean> {
    if (this.typos.has(code)) return true;
    const existing = this.loadPromises.get(code);
    if (existing) return existing;
    const p = this._doLoadLanguage(code, opts);
    this.loadPromises.set(code, p);
    try {
      return await p;
    } finally {
      this.loadPromises.delete(code);
    }
  }

  private async _doLoadLanguage(
    code: string,
    opts?: { affUrl?: string; dicUrl?: string; label?: string; persist?: boolean },
  ): Promise<boolean> {
    // 1. Try bundled first for the built-in language.
    if (code === BUILTIN_LANGUAGE) {
      try {
        let [aff, dic] = await Promise.all([
          fetch('/dictionaries/en_US.aff').then((r) => (r.ok ? r.text() : null)),
          fetch('/dictionaries/en_US.dic').then((r) => (r.ok ? r.text() : null)),
        ]);
        if (aff && dic) {
          if (aff.charCodeAt(0) === 0xfeff) aff = aff.slice(1);
          if (dic.charCodeAt(0) === 0xfeff) dic = dic.slice(1);
          const affHead = aff.split(/\r?\n/, 30).join('\n');
          if (/(^|\n)SET\s/.test(affHead) && /^\d+/.test(dic.trimStart())) {
            this.typos.set(code, new Typo(code, aff, dic));
            if (opts?.label) this.labels.set(code, opts.label);
            else this.labels.set(code, 'English (US)');
            this.emitChange();
            return true;
          }
        }
      } catch (err) {
        console.warn('SpellChecker: bundled load failed for', code, err);
      }
    }

    // 2. Try IndexedDB cache.
    try {
      const cached = await dbGet(code);
      if (cached && cached.aff && cached.dic) {
        this.typos.set(code, new Typo(code, cached.aff, cached.dic));
        if (cached.label) this.labels.set(code, cached.label);
        else if (opts?.label) this.labels.set(code, opts.label);
        this.emitChange();
        return true;
      }
    } catch (err) {
      console.warn('SpellChecker: cache lookup failed for', code, err);
    }

    // 3. Network download (jsdelivr by default).
    const affUrl = opts?.affUrl;
    const dicUrl = opts?.dicUrl;
    if (!affUrl || !dicUrl) return false;
    try {
      const [affRes, dicRes] = await Promise.all([fetch(affUrl), fetch(dicUrl)]);
      if (!affRes.ok || !dicRes.ok) {
        console.error('SpellChecker: download failed for', code,
          'aff:', affRes.status, 'dic:', dicRes.status);
        return false;
      }
      let [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
      // Some upstream files (notably LibreOffice's Indian-language .aff files)
      // ship a UTF-8 BOM. response.text() usually strips it, but not always —
      // strip defensively so the SET-line validation and typo-js parser don't
      // trip on a leading ﻿.
      if (aff.charCodeAt(0) === 0xfeff) aff = aff.slice(1);
      if (dic.charCodeAt(0) === 0xfeff) dic = dic.slice(1);
      // Sanity check: the .aff should contain a SET line somewhere near the top
      // (preceded only by comments / blank lines / other directives), and the
      // .dic must start with the word-count line. This catches HTML 404 pages
      // without rejecting files that lead with a comment block.
      const affHead = aff.split(/\r?\n/, 30).join('\n');
      if (!/(^|\n)SET\s/.test(affHead) || !/^\d+/.test(dic.trimStart())) {
        console.error('SpellChecker: downloaded data looks invalid for', code);
        return false;
      }
      this.typos.set(code, new Typo(code, aff, dic));
      if (opts?.label) this.labels.set(code, opts.label);
      // Persist to IndexedDB so future sessions don't re-download.
      if (opts?.persist !== false) {
        await dbPut({ code, aff, dic, label: opts?.label, source: 'jsdelivr' });
      }
      this.emitChange();
      return true;
    } catch (err) {
      console.error('SpellChecker: download error for', code, err);
      return false;
    }
  }

  /** Remove a downloaded language. The built-in language can't be removed. */
  async unloadLanguage(code: string): Promise<void> {
    if (code === BUILTIN_LANGUAGE) return;
    this.typos.delete(code);
    this.labels.delete(code);
    this.enabledLanguages.delete(code);
    await dbDelete(code);
    this.emitChange();
  }

  getLoadedLanguages(): { code: string; label: string }[] {
    return [...this.typos.keys()].sort().map((code) => ({
      code,
      label: this.labels.get(code) || code,
    }));
  }

  getEnabledLanguages(): string[] {
    return [...this.enabledLanguages].sort();
  }

  setEnabledLanguages(codes: string[]): void {
    // Accept codes even if their dictionary isn't loaded *yet* — re-hydration
    // from IndexedDB is async and can finish after a script's persisted
    // enabled-languages list has been applied. The check() loop already skips
    // codes whose typo isn't present, so storing them is safe and lets the
    // dictionary become live as soon as it finishes loading. Filtering here
    // silently dropped non-English languages on script load, which caused
    // every word in those languages to be flagged as misspelled.
    this.enabledLanguages.clear();
    for (const c of codes) {
      this.enabledLanguages.add(c);
    }
    if (this.enabledLanguages.size === 0) {
      this.enabledLanguages.add(BUILTIN_LANGUAGE);
    }
    this.emitChange();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Checking

  check(word: string): boolean {
    // Normalize curly apostrophes to straight so contractions like "doesn't"
    // typed with smart quotes match Hunspell's dictionary entries.
    const normalized = word.replace(/[‘’]/g, "'");
    const lower = normalized.toLowerCase();

    if (this.projectDictionaryEnabled && this.projectWords.has(lower)) return true;
    if (this.ignoreWords.has(lower)) return true;
    for (const name of this.enabledGlobalDicts) {
      const dict = this.globalDicts.get(name);
      if (dict && dict.has(lower)) return true;
    }
    for (const code of this.enabledLanguages) {
      const typo = this.typos.get(code);
      if (typo && (typo.check(normalized) as boolean)) return true;
    }
    // If no language is loaded at all (still booting), don't flag.
    if (this.typos.size === 0) return true;
    return false;
  }

  /** Check if a specific occurrence is ignored via "Ignore Once". */
  isIgnoredOnce(word: string, contextKey: string): boolean {
    return this.ignoredOnce.has(`${word.toLowerCase()}|${contextKey}`);
  }

  suggest(word: string): string[] {
    // Aggregate suggestions across all enabled languages, preserving order
    // (enabled-language order) and de-duplicating.
    const out: string[] = [];
    const seen = new Set<string>();
    for (const code of this.enabledLanguages) {
      const typo = this.typos.get(code);
      if (!typo) continue;
      const s = (typo.suggest(word, 5) as string[]) || [];
      for (const w of s) {
        if (seen.has(w)) continue;
        seen.add(w);
        out.push(w);
        if (out.length >= 5) return out;
      }
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Project dictionary

  /** Add a word to the current project's private dictionary. */
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

  /** Whether the project dictionary is consulted during checks. */
  isProjectDictionaryEnabled(): boolean {
    return this.projectDictionaryEnabled;
  }

  setProjectDictionaryEnabled(enabled: boolean): void {
    if (this.projectDictionaryEnabled === enabled) return;
    this.projectDictionaryEnabled = enabled;
    this.emitChange();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Global dictionaries

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

  // ─────────────────────────────────────────────────────────────────────────
  // Add-to-Dictionary targets (global setting)

  /** Dictionaries that "Add to Dictionary" writes to. */
  getAddTargets(): string[] {
    return [...this.addTargets].sort();
  }

  setAddTargets(targets: string[]): void {
    this.addTargets.clear();
    for (const t of targets) this.addTargets.add(t);
    this.emitChange();
  }

  /** Returns the list of add-targets that are usable *right now* for this
   *  project, in a stable order: project (if enabled) first, then enabled
   *  global dictionaries alphabetically. Filters out globals that aren't
   *  enabled for this project so the menu doesn't offer dead targets. */
  getActiveAddTargets(): string[] {
    const out: string[] = [];
    if (this.addTargets.has(PROJECT_DICT_TARGET) && this.projectDictionaryEnabled) {
      out.push(PROJECT_DICT_TARGET);
    }
    const globalNames = [...this.addTargets]
      .filter((t) => t !== PROJECT_DICT_TARGET)
      .filter((name) => this.globalDicts.has(name))
      .sort();
    out.push(...globalNames);
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Change notifications

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

  // ─────────────────────────────────────────────────────────────────────────
  // Ignore (per-document)

  /** Ignore all occurrences of a word in this document. */
  ignoreWord(word: string): void {
    this.ignoreWords.add(word.toLowerCase());
  }

  /** Ignore a specific occurrence of a word (identified by surrounding context). */
  ignoreOnce(word: string, contextKey: string): void {
    this.ignoredOnce.add(`${word.toLowerCase()}|${contextKey}`);
  }

  getIgnoredWords(): string[] {
    return [...this.ignoreWords];
  }

  setIgnoredWords(words: string[]): void {
    this.ignoreWords.clear();
    for (const w of words) {
      this.ignoreWords.add(w.toLowerCase());
    }
  }

  getIgnoredOnce(): string[] {
    return [...this.ignoredOnce];
  }

  setIgnoredOnce(entries: string[]): void {
    this.ignoredOnce.clear();
    for (const e of entries) {
      this.ignoredOnce.add(e);
    }
  }

  /**
   * Build a context key for a word occurrence.
   * Uses up to 20 chars before + 20 chars after the word within the text node.
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
      // Unicode-aware tokenizer: matches any letter (incl. Devanagari, CJK,
      // Cyrillic, etc.) optionally followed by combining marks, plus straight
      // and curly apostrophes for contractions.
      const wordRegex = /[\p{L}\p{M}'‘’]+/gu;
      let match: RegExpExecArray | null;
      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[0];
        if (word.length < 2) continue;
        // Skip ACRONYMS, but only for cased scripts (see SpellCheck.ts).
        if (
          word === word.toUpperCase() &&
          word !== word.toLowerCase() &&
          word.length > 1
        ) continue;
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
