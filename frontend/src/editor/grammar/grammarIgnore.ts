// Per-document ignore state for grammar issues.
// Mirrors the spellChecker ignore pattern (see ../spellchecker.ts).
//
// Two scopes:
//   - ignoredOnce: a single occurrence at a specific context, identified by
//     a fingerprint of the surrounding text (so it survives reordering).
//   - ignoredRules (per-document): suppress every occurrence of a category
//     for the rest of the doc lifetime. Persisted alongside _ignoredWords.
//
// Per-rule disable for ALL documents lives in editorStore.grammarRulesEnabled.

export class GrammarIgnore {
  private ignoredOnce: Set<string> = new Set();
  private ignoredRules: Set<string> = new Set();

  static buildContextKey(text: string, matchIndex: number, length: number): string {
    const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
    const after = text.slice(matchIndex + length, matchIndex + length + 20);
    return `${before}>><<${after}`;
  }

  isIgnoredOnce(ruleId: string, contextKey: string): boolean {
    return this.ignoredOnce.has(`${ruleId}|${contextKey}`);
  }

  ignoreOnce(ruleId: string, contextKey: string): void {
    this.ignoredOnce.add(`${ruleId}|${contextKey}`);
  }

  isRuleIgnored(ruleId: string): boolean {
    return this.ignoredRules.has(ruleId);
  }

  ignoreRuleForDoc(ruleId: string): void {
    this.ignoredRules.add(ruleId);
  }

  unignoreRuleForDoc(ruleId: string): void {
    this.ignoredRules.delete(ruleId);
  }

  getIgnoredOnce(): string[] {
    return [...this.ignoredOnce];
  }

  setIgnoredOnce(entries: string[]): void {
    this.ignoredOnce.clear();
    for (const e of entries) this.ignoredOnce.add(e);
  }

  getIgnoredRules(): string[] {
    return [...this.ignoredRules];
  }

  setIgnoredRules(rules: string[]): void {
    this.ignoredRules.clear();
    for (const r of rules) this.ignoredRules.add(r);
  }
}

export const grammarIgnore = new GrammarIgnore();
