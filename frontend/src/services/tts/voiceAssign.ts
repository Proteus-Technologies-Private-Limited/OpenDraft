/**
 * Who reads what in a Table Read: the narrator, and a voice per character.
 *
 * A voice the writer picked on the character profile always wins. Everyone
 * else is cast automatically from the voices left over — in the writer's
 * language where there is a choice, matching the gender on the profile when
 * the engine says what a voice is, and each character a different voice for
 * as long as there are voices to go round.
 */
import type { CharacterProfile, CharacterVoice } from '../../stores/editorStore';
import type { EngineKind, VoiceInfo } from './types';
import type { ReadLine } from './script';

export interface Casting {
  narrator: string | null;
  bySpeaker: Map<string, string | null>;
}

/** 'female' / 'male' from whatever the writer typed in the profile's Gender field. */
export function genderOf(text: string | undefined): 'female' | 'male' | undefined {
  const t = (text || '').trim().toLowerCase();
  if (!t) return undefined;
  if (/^(f|female|woman|girl|she|her)\b/.test(t)) return 'female';
  if (/^(m|male|man|boy|he|him)\b/.test(t)) return 'male';
  return undefined;
}

const HE = /\b(he|him|his|himself)\b/gi;
const SHE = /\b(she|her|hers|herself)\b/gi;

/**
 * Gender of each speaking character, read off the action lines that
 * introduce them: "MARCUS WEBB (40s) enters, shaking rain off his umbrella.
 * He spots Sarah…". Counts the pronouns after the character's name in
 * capitals, in the first action line that has it, and only calls it when
 * one side clearly wins. A guess for casting, never shown as fact.
 */
export function inferGenders(lines: ReadLine[], speakers: string[]): Map<string, 'female' | 'male'> {
  const out = new Map<string, 'female' | 'male'>();
  const action = lines.filter((l) => l.kind === 'action');
  for (const name of speakers) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`);
    const intro = action.find((l) => re.test(l.text));
    if (!intro) continue;
    const after = intro.text.slice(intro.text.search(re));
    const he = (after.match(HE) || []).length;
    const she = (after.match(SHE) || []).length;
    if (he > she) out.set(name, 'male');
    else if (she > he) out.set(name, 'female');
  }
  return out;
}

function slotOf(kind: EngineKind): keyof CharacterVoice {
  return kind === 'ai' ? 'ai' : 'system';
}

/** Primary language subtag, lowercased: 'en-GB' → 'en'. */
function langOf(tag: string): string {
  return (tag || '').toLowerCase().split(/[-_]/)[0];
}

export function castVoices(args: {
  kind: EngineKind;
  voices: VoiceInfo[];
  /** Character keys in the order they first speak. */
  speakers: string[];
  profiles: CharacterProfile[];
  narrator: CharacterVoice;
  /** e.g. navigator.language */
  preferredLang: string;
  /** Genders read off the script (inferGenders); the profile's Gender field wins. */
  inferred?: Map<string, 'female' | 'male'>;
}): Casting {
  const { kind, voices, speakers, profiles, preferredLang } = args;
  const slot = slotOf(kind);
  const ids = new Set(voices.map((v) => v.id));
  const want = langOf(preferredLang);

  // Voices in the writer's language first; the rest only if there are none.
  // Voices that report no language at all (AI providers) count as a match.
  // Novelty voices are for choosing by hand, never for casting.
  const reading = voices.filter((v) => !v.novelty);
  const candidates = reading.length ? reading : voices;
  const inLang = candidates.filter((v) => !v.lang || langOf(v.lang) === want);
  const pool = inLang.length ? inLang : candidates;

  const narratorChoice = args.narrator[slot];
  const narrator = narratorChoice && ids.has(narratorChoice)
    ? narratorChoice
    : pool[0]?.id ?? null;

  const profileByName = new Map(profiles.map((p) => [p.name.toUpperCase(), p]));
  const bySpeaker = new Map<string, string | null>();
  const used = new Set<string>();
  if (narrator) used.add(narrator);

  // Explicit choices first, so automatic casting steers around them.
  for (const name of speakers) {
    const chosen = profileByName.get(name)?.voice?.[slot];
    if (chosen && ids.has(chosen)) {
      bySpeaker.set(name, chosen);
      used.add(chosen);
    }
  }

  // How many characters each gender has been given so far, so that cast
  // members whose gender nobody knows alternate rather than all landing on
  // whichever voices happen to be listed first.
  const genderCount = { female: 0, male: 0 };
  for (const id of bySpeaker.values()) {
    const g = voices.find((v) => v.id === id)?.gender;
    if (g) genderCount[g]++;
  }

  let cursor = 0;
  for (const name of speakers) {
    if (bySpeaker.has(name)) continue;
    const gender = genderOf(profileByName.get(name)?.gender) ?? args.inferred?.get(name);
    const fits = (v: VoiceInfo) => !gender || !v.gender || v.gender === gender;
    const fresh = pool.filter((v) => !used.has(v.id));
    // Out of unused voices: reuse, still respecting gender where known, but
    // never the narrator unless it is the only voice there is.
    const reusable = pool.filter((v) => v.id !== narrator && fits(v));
    const lessUsed: 'female' | 'male' = genderCount.female <= genderCount.male ? 'female' : 'male';
    const pick =
      (gender ? fresh.find((v) => v.gender === gender) : fresh.find((v) => v.gender === lessUsed)) ??
      fresh.find(fits) ??
      (reusable.length ? reusable[cursor++ % reusable.length] : pool[0]);
    const id = pick?.id ?? narrator;
    bySpeaker.set(name, id);
    if (id) used.add(id);
    if (pick?.gender) genderCount[pick.gender]++;
  }

  return { narrator, bySpeaker };
}
