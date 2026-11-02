/**
 * The deterministic path for the simplest request a writer makes:
 *
 *   Ben dice: "Ciao a tutti."
 *   Scrivi un dialogo di Ben che dice «Ciao a tutti»
 *
 * A local 3B model does not need to be asked to turn that into a tool call.
 * Parsing it here is instant, free, and exact — and it keeps working when the
 * model is too small to follow a long instruction. Anything less obvious (two
 * speakers, a whole scene, no explicit verb) returns null and goes to the model.
 */

export interface QuickDialogue {
  character: string;
  text: string;
}

export const SPEECH_VERBS = [
  // Italian, because the writer may type in Italian.
  'dice', 'urla', 'grida', 'sussurra', 'risponde', 'mormora', 'dichiara', 'chiede', 'aggiunge',
  // English.
  'says', 'say', 'yells', 'shouts', 'whispers', 'replies', 'asks', 'adds', 'screams',
];

/** Words that are never a character name at the end of the lead-in. */
const STOPWORDS = new Set([
  'che', 'di', 'a', 'da', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
  'e', 'ed', 'poi', 'ora', 'adesso', 'quindi', 'fai', 'scrivi', 'dialogo', 'frase',
  'battuta', 'una', 'un', 'del', 'della', 'dei', 'delle',
  'the', 'a', 'an', 'and', 'then', 'now', 'later', 'please', 'write', 'dialogue',
  'line', 'have', 'for', 'to', 'of', 'with',
]);

const VERB_RE = new RegExp(`\\b(${SPEECH_VERBS.join('|')})\\b`, 'gi');
const FAI_DIRE_RE = /\bfai\s+dire\s+a\s+([\p{L}][\p{L}'’ -]{0,40}?)\s*[:,]\s*(.+)$/iu;

function extractQuoted(text: string): string | null {
  for (const pattern of [/«([^»]+)»/, /“([^”]+)”/, /"([^"]+)"/]) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1].trim();
      if (value) return value.slice(0, 2000);
    }
  }
  return null;
}

/** Text after the verb when the writer did not use quotes. */
function extractUnquoted(after: string): string | null {
  let text = after.replace(/^\s*[:,]\s*/, '').trim();
  if (!text) return null;
  // More than one sentence: probably an action after the line, leave it to the model.
  if (/[.!?]\s+\S/.test(text)) return null;
  text = text.replace(/^["«“']|["»”']$/g, '').trim();
  return text ? text.slice(0, 2000) : null;
}

/**
 * The name before the speech verb. A capitalised word is a name; a lowercase
 * word only if it is a character the script already knows. That is what keeps
 * "Ben lo guarda e dice" from attributing the line to "guarda".
 */
function extractSpeaker(before: string, known: Set<string>): string | null {
  const words = before
    .replace(/[^\p{L}\p{N}'’ -]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let end = words.length - 1;
  while (end >= 0 && STOPWORDS.has(words[end].toLowerCase())) end--;
  if (end < 0) return null;

  const clean = words[end].replace(/[^\p{L}'’ -]/gu, '');
  if (!clean) return null;
  const capitalised = /^[A-ZÀ-Ý]/.test(clean);
  const meaningful = words
    .slice(0, end + 1)
    .map((word) => word.replace(/[^\p{L}'’ -]/gu, '').toLowerCase())
    .filter((word) => word && !STOPWORDS.has(word));
  // A lowercase name is still a name when it is the only word in the lead-in
  // ("ben dice"), but not when it is an ordinary verb in a longer sentence
  // ("Ben lo guarda e dice").
  if (!capitalised && !known.has(clean.toLowerCase()) && meaningful.length !== 1) {
    return null;
  }

  let name = clean;
  const previous = words[end - 1]?.replace(/[^\p{L}'’ -]/gu, '') ?? '';
  if (previous && /^[A-ZÀ-Ý]/.test(previous) && !STOPWORDS.has(previous.toLowerCase())) {
    name = `${previous} ${name}`;
  }
  return name;
}

/**
 * A dialogue the fast path can write itself, or null when the request needs
 * the model. `knownCharacters` are the cues already in the script, so lowercase
 * names can still be recognised.
 */
export function parseQuickDialogue(
  prompt: string,
  knownCharacters: readonly string[] = [],
): QuickDialogue | null {
  const input = prompt.trim();
  if (!input || input.length > 400) return null;

  // "Fai dire a Ben: ..." puts the name after the verb, so the general path
  // below cannot see it.
  const faiDire = input.match(FAI_DIRE_RE);
  if (faiDire) {
    const text = extractQuoted(faiDire[2]) ?? extractUnquoted(faiDire[2]);
    if (text) {
      return { character: faiDire[1].trim().toUpperCase(), text };
    }
  }

  const verbs = [...input.matchAll(VERB_RE)];
  if (verbs.length !== 1) return null;
  const verb = verbs[0];
  const start = verb.index ?? 0;
  const before = input.slice(0, start);
  const after = input.slice(start + verb[0].length);

  const text = extractQuoted(after) ?? extractUnquoted(after);
  if (!text) return null;

  const known = new Set(knownCharacters.map((name) => name.toLowerCase()));
  const character = extractSpeaker(before, known);
  if (!character) return null;

  return { character: character.toUpperCase(), text };
}
