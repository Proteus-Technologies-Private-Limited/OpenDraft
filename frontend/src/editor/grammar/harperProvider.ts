// Harper-powered grammar provider. Harper is an open-source, rule-based
// English grammar checker that runs locally via WebAssembly. Unlike the
// retext stack (style/wordiness only), harper catches actual grammar
// mistakes: subject-verb agreement, tense, articles, confusables, etc.
//
// We load harper lazily so its ~17 MB WASM blob only ships when grammar
// checking is actually enabled, and run it on a Web Worker so large
// documents don't block the main thread.

import type { GrammarIssue, GrammarSeverity } from '../../plugins/registry';

// Stable category ids. These are harper's lint_kind() values, kept in a
// closed set so the rules UI can render them and "Disable rule" persists
// across harper upgrades.
export const HARPER_CATEGORIES = [
  'Agreement',
  'Grammar',
  'Capitalization',
  'Repetition',
  'Punctuation',
  'WordChoice',
  'Readability',
  'Typo',
  'Spelling',
  'Style',
  'Enhancement',
  'Formatting',
  'Regionalism',
  'Miscellaneous',
] as const;

export type HarperCategory = (typeof HARPER_CATEGORIES)[number];

export const HARPER_CATEGORY_META: Record<
  HarperCategory,
  { label: string; severity: GrammarSeverity; description: string }
> = {
  Agreement: { label: 'Subject–verb agreement', severity: 'grammar', description: 'Verb form must match the subject ("she walk" → "she walks").' },
  Grammar: { label: 'Grammar', severity: 'grammar', description: 'Tense, confusables (their/they\'re), pronoun case, and similar mistakes.' },
  Capitalization: { label: 'Capitalization', severity: 'grammar', description: 'Proper nouns, sentence starts, the pronoun "I".' },
  Repetition: { label: 'Repeated word', severity: 'grammar', description: 'Accidental "the the".' },
  Punctuation: { label: 'Punctuation', severity: 'grammar', description: 'Missing commas, stray spaces around punctuation.' },
  WordChoice: { label: 'Word choice', severity: 'style', description: 'Suggests a clearer or more idiomatic word.' },
  Readability: { label: 'Readability', severity: 'style', description: 'Long or hard-to-parse sentences.' },
  Typo: { label: 'Typo', severity: 'grammar', description: 'Likely typos detected from context (e.g. "teh" → "the").' },
  Spelling: { label: 'Spelling', severity: 'grammar', description: 'Misspelled words (overlaps with the spell checker — disable one).' },
  Style: { label: 'Style', severity: 'style', description: 'Stylistic suggestions (wordiness, weak phrasing).' },
  Enhancement: { label: 'Enhancement', severity: 'style', description: 'Optional rewrites that often improve clarity.' },
  Formatting: { label: 'Formatting', severity: 'style', description: 'Spacing, quotation marks, dashes.' },
  Regionalism: { label: 'Regionalism', severity: 'style', description: 'Word usage that is unusual outside a particular region.' },
  Miscellaneous: { label: 'Other', severity: 'grammar', description: 'Other grammar issues that don\'t fit the categories above.' },
};

const HARPER_CATEGORY_SET = new Set<string>(HARPER_CATEGORIES);

interface HarperLintShape {
  span(): { start: number; end: number };
  message(): string;
  lint_kind(): string;
  suggestions(): { get_replacement_text(): string }[];
}

interface HarperLinterShape {
  setup(): Promise<void>;
  lint(text: string, options: { language: 'plaintext' }): Promise<HarperLintShape[]>;
}

let linterPromise: Promise<HarperLinterShape> | null = null;

async function getLinter(): Promise<HarperLinterShape> {
  if (linterPromise) return linterPromise;
  linterPromise = (async () => {
    // Dynamic imports so harper's WASM only loads when grammar is enabled.
    // WorkerLinter offloads linting to a Web Worker, which keeps the editor
    // responsive on long documents.
    const [{ WorkerLinter }, { binary }] = await Promise.all([
      import('harper.js'),
      import('harper.js/binary'),
    ]);
    const linter = new WorkerLinter({ binary }) as unknown as HarperLinterShape;
    await linter.setup();
    return linter;
  })();
  // If init fails, drop the cached promise so a later call retries.
  linterPromise.catch(() => { linterPromise = null; });
  return linterPromise;
}

/**
 * Run harper over a single text block.
 *
 * @param text       Plain text of the block.
 * @param baseOffset ProseMirror doc position of text[0].
 * @param signal     AbortSignal — if aborted, returns [] without dispatching.
 */
export async function runHarper(
  text: string,
  baseOffset: number,
  signal: AbortSignal,
): Promise<GrammarIssue[]> {
  if (!text.trim()) return [];
  if (signal.aborted) return [];

  let linter: HarperLinterShape;
  try {
    linter = await getLinter();
  } catch (err) {
    console.error('runHarper: failed to load harper linter', err);
    return [];
  }
  if (signal.aborted) return [];

  let lints: HarperLintShape[];
  try {
    lints = await linter.lint(text, { language: 'plaintext' });
  } catch (err) {
    console.error('runHarper: linter.lint failed', err);
    return [];
  }
  if (signal.aborted) return [];

  const issues: GrammarIssue[] = [];
  for (const lint of lints) {
    let kind: string;
    let span: { start: number; end: number };
    let message: string;
    let suggestions: string[];
    try {
      kind = lint.lint_kind();
      span = lint.span();
      message = lint.message();
      suggestions = lint.suggestions().map((s) => s.get_replacement_text());
    } catch (err) {
      // Lint objects are WASM-backed and become invalid once their parent
      // run is garbage-collected; skip any that fail to read.
      console.warn('runHarper: failed to read lint', err);
      continue;
    }
    if (typeof span.start !== 'number' || typeof span.end !== 'number') continue;
    if (span.end <= span.start) continue;

    // Unknown kinds (harper may add new ones in future versions) still get
    // surfaced, bucketed under "Miscellaneous" so the rules panel can toggle
    // them.
    const ruleId: string = HARPER_CATEGORY_SET.has(kind) ? kind : 'Miscellaneous';
    const meta = HARPER_CATEGORY_META[ruleId as HarperCategory];

    issues.push({
      from: baseOffset + span.start,
      to: baseOffset + span.end,
      message,
      ruleId,
      severity: meta.severity,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    });
  }
  return issues;
}
