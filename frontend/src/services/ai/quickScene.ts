/**
 * The deterministic path for a scene change:
 *
 *   "ora siamo fuori casa, poco dopo. Vilgax sta cacando"
 *   "interno casa giorno, Ben entra arrabbiato"
 *   "We are outside the house, a little later. Vilgax waits."
 *
 * A small local model reads that as a transition (or misses it). The rule is
 * simple enough to apply here: a new place or time is a scene heading, and the
 * sentence after it is action. Anything ambiguous returns null and goes to the
 * model with the preview.
 */

import { SPEECH_VERBS } from './quickIntent';

export interface QuickScene {
  heading: string;
  action?: string;
}

export interface QuickScript {
  blocks: Array<{ type: 'sceneHeading' | 'action' | 'character' | 'dialogue'; text: string }>;
}

const QUOTE_RE = /«([^»]*)»|“([^”]*)”|"([^"]*)"/g;
const SPEECH_RE = new RegExp(`\\b(${SPEECH_VERBS.join('|')})\\b`, 'gi');

function firstWord(text: string): string | null {
  const cleaned = text
    .replace(/^[\s,.;:!?–—-]+/, '')
    .replace(/^(?:e|ed|poi|and|then|ora|now)\s+/i, '')
    .trim();
  const match = cleaned.match(/^[\p{L}][\p{L}'’ -]*/u);
  return match ? match[0].split(/\s+/)[0] : null;
}

/** The action without its subject: "ben rimane impalato" -> "rimane impalato". */
function withoutSpeaker(text: string, speaker: string): string {
  const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`^(?:e|ed|poi|and|then)?\\s*${escaped}\\b`, 'i'), '')
    .replace(/^(?:e|ed|poi|and|then)\s+/i, '')
    .trim();
}

const TIME_WORDS: Record<string, string> = {
  'giorno': 'DAY',
  'di giorno': 'DAY',
  'notte': 'NIGHT',
  'di notte': 'NIGHT',
  'mattina': 'MORNING',
  'la mattina': 'MORNING',
  'sera': 'EVENING',
  'la sera': 'EVENING',
  'pomeriggio': 'AFTERNOON',
  'alba': "DAWN",
  "all'alba": 'DAWN',
  "all’alba": 'DAWN',
  'tramonto': 'DUSK',
  'al tramonto': 'DUSK',
  'poco dopo': 'LATER',
  'più tardi': 'LATER',
  'il giorno dopo': 'NEXT DAY',
  'day': 'DAY',
  'night': 'NIGHT',
  'morning': 'MORNING',
  'evening': 'EVENING',
  'afternoon': 'AFTERNOON',
  'dawn': 'DAWN',
  'dusk': 'DUSK',
  'later': 'LATER',
  'a little later': 'LATER',
  'the next day': 'NEXT DAY',
};

function timeWord(raw: string | undefined): string | null {
  if (!raw) return null;
  return TIME_WORDS[raw.trim().toLowerCase()] ?? raw.trim().toUpperCase();
}

/** A rest that contains dialogue belongs to the model, not to a one-line action. */
const DIALOGUE_MARK = /["«“”]|\b(dice|urla|grida|sussurra|risponde|mormora|dichiara|chiede|says|yells|shouts|whispers|replies|asks)\b/i;

function sceneResult(heading: string, rest: string): QuickScene | null {
  // If the text after the heading carries a quoted line, the quick path must
  // not flatten it into one action: the model (and the preview) should split
  // the beats. Returning null sends the whole prompt there.
  if (rest && DIALOGUE_MARK.test(rest)) return null;
  return { heading, action: rest || undefined };
}

function prefixFor(direction: string): 'INT.' | 'EXT.' {
  return /fuori|esterno|outside|ext/i.test(direction) ? 'EXT.' : 'INT.';
}

/** Split the first sentence from the rest, keeping the rest intact. */
function splitFirstSentence(text: string): { clause: string; rest: string } {
  const at = text.search(/[.!]\s+/);
  if (at < 0) return { clause: text.trim(), rest: '' };
  return {
    clause: text.slice(0, at).trim(),
    rest: text.slice(at + 1).trim(),
  };
}

const MOVE_IT = /^(?:ora\s+)?(?:siamo|ci\s+troviamo|andiamo)\s+(fuori|dentro|all['’]?esterno|all['’]?interno)\s+(?:a\s+|in\s+|nel\s+|nella\s+|da\s+)?([\s\S]+)$/iu;
const MOVE_EN = /^(?:now\s+)?(?:we\s+are|we're)\s+(outside|inside)\s+(?:the\s+)?([\s\S]+)$/i;
const HEADING_IT = /^(interno|esterno|int\.?|ext\.?|fuori|dentro)\s+([\p{L}][\p{L}'’ -]{1,40}?)\s*(?:-\s*|,\s*|\s+)(giorno|di giorno|notte|di notte|mattina|la mattina|sera|la sera|pomeriggio|alba|all['’]?alba|tramonto|al tramonto|day|night|morning|evening|afternoon|dawn|dusk)\s*[.,]\s*([\s\S]*)$/iu;
/** A bare heading with no punctuation after it: "esterno casa notte". */
const BARE_HEADING_IT = /^(interno|esterno|int\.?|ext\.?|fuori|dentro)\s+([\p{L}][\p{L}'’ -]{1,40}?)\s*(?:-\s*|,\s*|\s+)(giorno|di giorno|notte|di notte|mattina|la mattina|sera|la sera|pomeriggio|alba|all['’]?alba|tramonto|al tramonto|day|night|morning|evening|afternoon|dawn|dusk)\s*$/iu;

export function parseQuickScene(prompt: string): QuickScene | null {
  const input = prompt.trim();
  if (!input || input.length > 600) return null;

  // "ora siamo fuori casa, poco dopo. <action>"
  const move = input.match(MOVE_IT) ?? input.match(MOVE_EN);
  if (move) {
    const direction = move[1];
    const tail = move[2].trim();
    const { clause, rest } = splitFirstSentence(tail);
    const comma = clause.indexOf(',');
    let place = comma >= 0 ? clause.slice(0, comma).trim() : clause;
    let time = comma >= 0 ? clause.slice(comma + 1).trim() : '';

    if (!time) {
      // "fuori casa poco dopo" without a comma.
      const suffix = place.match(/(poco dopo|più tardi|il giorno dopo|di notte|di giorno|all['’]?alba|al tramonto|la sera|la mattina)\s*$/iu);
      if (suffix) {
        time = suffix[1];
        place = place.slice(0, suffix.index).trim();
      }
    }
    place = place.replace(/^(?:a|in|nel|nella|da|the)\s+/i, '').trim();
    if (!place || place.length > 60) return null;
    const heading = `${prefixFor(direction)} ${place.toUpperCase()}${time ? ` - ${timeWord(time)}` : ''}`;
    return sceneResult(heading, rest);
  }

  // A heading on its own, with no punctuation or action after it.
  const bare = input.match(BARE_HEADING_IT);
  if (bare) {
    const place = bare[2].trim();
    if (place) {
      return { heading: `${prefixFor(bare[1])} ${place.toUpperCase()} - ${timeWord(bare[3])}` };
    }
  }

  // "interno casa giorno, <action>" (also INT./EXT. and the English times).
  const heading = input.match(HEADING_IT);
  if (heading) {
    const place = heading[2].trim();
    if (!place) return null;
    const time = timeWord(heading[3]);
    const rest = heading[4].trim();
    const headingText = `${prefixFor(heading[1])} ${place.toUpperCase()}${time ? ` - ${time}` : ''}`;
    return sceneResult(headingText, rest);
  }

  return null;
}

/**
 * A heading plus a body with quoted lines: split it into scene, actions and
 * dialogues without the model. The quote is a dialogue; the text before its
 * speech verb is the action; the first name in that clause is the speaker.
 * Returns null when the pattern is not clear enough.
 */
export function parseSceneWithDialogue(prompt: string): QuickScript | null {
  const input = prompt.trim();
  if (!input || input.length > 1200) return null;
  const heading = input.match(HEADING_IT);
  if (!heading) return null;
  const place = heading[2].trim();
  if (!place) return null;
  const body = heading[4].trim();
  if (!body) return null;
  const quotes = [...body.matchAll(QUOTE_RE)];
  if (quotes.length === 0) return null;

  const time = timeWord(heading[3]);
  const blocks: QuickScript['blocks'] = [{
    type: 'sceneHeading',
    text: `${prefixFor(heading[1])} ${place.toUpperCase()}${time ? ` - ${time}` : ''}`,
  }];

  let cursor = 0;
  for (const quote of quotes) {
    const start = quote.index ?? 0;
    const before = body.slice(cursor, start);
    const quoteText = (quote[1] ?? quote[2] ?? quote[3] ?? '').trim();
    if (!quoteText) {
      cursor = start + quote[0].length;
      continue;
    }

    const sentences = before.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const last = sentences.pop() ?? '';
    for (const sentence of sentences) blocks.push({ type: 'action', text: sentence });

    let speaker: string | null = null;
    let actionText = '';
    const verbs = [...last.matchAll(SPEECH_RE)];
    const verb = verbs[verbs.length - 1];
    if (verb) {
      const lead = last.slice(0, verb.index ?? 0).trim();
      speaker = firstWord(lead);
      actionText = lead.replace(/\s+(?:e|ed|e poi|poi|and|then)\s*$/i, '').trim();
      if (speaker && !withoutSpeaker(actionText, speaker)) actionText = '';
    } else {
      const colon = last.match(/([\p{L}][\p{L}'’ -]{0,40}?)\s*:\s*$/u);
      if (colon) speaker = colon[1].trim();
    }
    if (!speaker) return null;

    if (actionText) blocks.push({ type: 'action', text: actionText });
    blocks.push({ type: 'character', text: speaker.toUpperCase() });
    blocks.push({ type: 'dialogue', text: quoteText });
    cursor = start + quote[0].length;
  }

  const tail = body.slice(cursor).trim().replace(/^[,.;:\s]+/, '');
  if (tail) blocks.push({ type: 'action', text: tail });
  return { blocks };
}
