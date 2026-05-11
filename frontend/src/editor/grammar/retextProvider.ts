// Local rule-based grammar/style provider, powered by the retext ecosystem.
// All retext modules are loaded lazily so the ~150 KB chunk only ships when
// writing suggestions are actually enabled.
//
// Categories double as the stable ruleId used for "Disable rule" — this keeps
// the per-rule UI simple and makes ignore-state portable across retext upgrades.

import type { GrammarIssue, GrammarSeverity } from '../../plugins/registry';

export const RETEXT_CATEGORIES = [
  'passive',
  'repeated',
  'indefinite-article',
  'redundant-acronyms',
  'intensify',
  'simplify',
] as const;

export type RetextCategory = (typeof RETEXT_CATEGORIES)[number];

export const RETEXT_CATEGORY_META: Record<RetextCategory, { label: string; severity: GrammarSeverity; description: string }> = {
  'passive': { label: 'Passive voice', severity: 'style', description: 'Flag passive constructions ("was kicked").' },
  'repeated': { label: 'Repeated word', severity: 'grammar', description: 'Catch accidental "the the".' },
  'indefinite-article': { label: 'A / an', severity: 'grammar', description: 'Detect "a hour" / "an university".' },
  'redundant-acronyms': { label: 'Redundant acronyms', severity: 'style', description: 'e.g. "ATM machine".' },
  'intensify': { label: 'Weak intensifier', severity: 'style', description: 'Suggest stronger alternatives to "very", "really".' },
  'simplify': { label: 'Wordy phrase', severity: 'style', description: 'Tighten "in order to" → "to".' },
};

let processorPromise: Promise<{
  process: (text: string) => Promise<{ messages: RetextMessage[] }>;
}> | null = null;

interface RetextMessage {
  reason?: string;
  source?: string;
  ruleId?: string;
  actual?: string;
  expected?: string[];
  place?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  // Older unified versions surface position instead of place.
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

async function getProcessor(enabled: Set<RetextCategory>) {
  // Cache by enabled-set fingerprint so toggling rules rebuilds the pipeline.
  const fingerprint = [...enabled].sort().join(',');
  if (processorPromise && (processorPromise as { __fp?: string }).__fp === fingerprint) {
    return processorPromise;
  }
  processorPromise = (async () => {
    const [
      { unified },
      retextEnglish,
      retextStringify,
      retextPassive,
      retextRepeatedWords,
      retextIndefiniteArticle,
      retextRedundantAcronyms,
      retextIntensify,
      retextSimplify,
    ] = await Promise.all([
      import('unified'),
      import('retext-english'),
      import('retext-stringify'),
      import('retext-passive'),
      import('retext-repeated-words'),
      import('retext-indefinite-article'),
      import('retext-redundant-acronyms'),
      import('retext-intensify'),
      import('retext-simplify'),
    ]);
    // The unified processor type narrows after each `.use()`, which prevents
    // reassignment in a conditional pipeline. We treat it as opaque here — the
    // public surface (`process(text)`) is all we use and is stable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let proc: any = unified().use(retextEnglish.default ?? retextEnglish);
    if (enabled.has('passive')) proc = proc.use(retextPassive.default ?? retextPassive);
    if (enabled.has('repeated')) proc = proc.use(retextRepeatedWords.default ?? retextRepeatedWords);
    if (enabled.has('indefinite-article')) proc = proc.use(retextIndefiniteArticle.default ?? retextIndefiniteArticle);
    if (enabled.has('redundant-acronyms')) proc = proc.use(retextRedundantAcronyms.default ?? retextRedundantAcronyms);
    if (enabled.has('intensify')) proc = proc.use(retextIntensify.default ?? retextIntensify);
    if (enabled.has('simplify')) proc = proc.use(retextSimplify.default ?? retextSimplify);
    proc = proc.use(retextStringify.default ?? retextStringify);
    return proc as { process: (text: string) => Promise<{ messages: RetextMessage[] }> };
  })();
  (processorPromise as { __fp?: string }).__fp = fingerprint;
  return processorPromise;
}

/** Map a retext message source string to our stable category key. */
function sourceToCategory(source?: string): RetextCategory | null {
  switch (source) {
    case 'retext-passive': return 'passive';
    case 'retext-repeated-words': return 'repeated';
    case 'retext-indefinite-article': return 'indefinite-article';
    case 'retext-redundant-acronyms': return 'redundant-acronyms';
    case 'retext-intensify': return 'intensify';
    case 'retext-simplify': return 'simplify';
    default: return null;
  }
}

/**
 * Run the retext pipeline over a single text block.
 *
 * @param text       Plain text of the block.
 * @param baseOffset ProseMirror doc position of text[0].
 * @param enabledCategories Set of rule categories currently enabled.
 * @param signal     AbortSignal — if aborted, returns [] without dispatching.
 */
export async function runRetext(
  text: string,
  baseOffset: number,
  enabledCategories: Set<RetextCategory>,
  signal: AbortSignal,
): Promise<GrammarIssue[]> {
  if (!text.trim() || enabledCategories.size === 0) return [];
  if (signal.aborted) return [];

  let processor: Awaited<ReturnType<typeof getProcessor>>;
  try {
    processor = await getProcessor(enabledCategories);
  } catch (err) {
    console.error('runRetext: failed to load retext pipeline', err);
    return [];
  }
  if (signal.aborted) return [];

  let file: { messages: RetextMessage[] };
  try {
    file = await processor.process(text);
  } catch (err) {
    console.error('runRetext: processor.process failed', err);
    return [];
  }
  if (signal.aborted) return [];

  const issues: GrammarIssue[] = [];
  for (const msg of file.messages || []) {
    const category = sourceToCategory(msg.source);
    if (!category) continue;
    const place = msg.place || msg.position;
    const startOff = place?.start?.offset;
    const endOff = place?.end?.offset;
    if (typeof startOff !== 'number' || typeof endOff !== 'number') continue;
    if (endOff <= startOff) continue;
    if (isKnownFalsePositive(text, startOff, endOff, category)) continue;
    issues.push({
      from: baseOffset + startOff,
      to: baseOffset + endOff,
      message: msg.reason || RETEXT_CATEGORY_META[category].label,
      ruleId: category,
      severity: RETEXT_CATEGORY_META[category].severity,
      suggestions: msg.expected && msg.expected.length > 0 ? msg.expected : undefined,
    });
  }
  return issues;
}

/**
 * Suppress retext-simplify hits where the flagged phrase is part of a
 * common English idiom or grammatical construction that the underlying
 * dictionary doesn't account for. retext-simplify is purely substring-based
 * — it flags "all of" without knowing it precedes "a sudden", "which",
 * "them", etc., where the simplification produces ungrammatical English.
 */
function isKnownFalsePositive(
  text: string,
  startOff: number,
  endOff: number,
  category: RetextCategory,
): boolean {
  if (category !== 'simplify') return false;
  const phrase = text.slice(startOff, endOff).toLowerCase();
  const after = text.slice(endOff).toLowerCase();
  // "all of" before "a sudden" / "which" / "whom" / pronouns / "the" is
  // idiomatic or syntactically required — leave it alone.
  if (phrase === 'all of') {
    if (/^\s+(a sudden|which|whom|the|that|these|those|my|your|his|her|its|our|their|them|us|you|me|him|it)\b/.test(after)) {
      return true;
    }
  }
  return false;
}
