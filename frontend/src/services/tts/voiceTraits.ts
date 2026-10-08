/**
 * What the platforms do not say about their own voices.
 *
 * `speechSynthesis` reports a voice's name and language and nothing else, so
 * automatic casting could not tell a woman's voice from a man's, and macOS
 * lists its novelty voices — Bubbles, Zarvox, Bad News — right beside the real
 * ones. The names below are the system voices macOS and Windows ship; a voice
 * not listed simply has no gender hint, which casting handles.
 */

const FEMALE = new Set([
  // macOS
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'victoria', 'allison', 'ava', 'susan', 'zoe',
  'serena', 'kate', 'nicky', 'joelle', 'noelle', 'flo', 'grandma', 'sandy', 'shelley', 'isha', 'vicki',
  'agnes', 'alice', 'amélie', 'amelie', 'anna', 'alva', 'amira', 'carmit', 'damayanti', 'daria', 'ellen',
  'geeta', 'ioana', 'joana', 'kanya', 'kyoko', 'lana', 'laura', 'lekha', 'linh', 'luciana', 'mariska',
  'mei-jia', 'melina', 'milena', 'monica', 'montse', 'nora', 'paulina', 'sara', 'satu', 'sinji', 'soumya',
  'ting-ting', 'tingting', 'vani', 'yelda', 'yuna', 'zuzana', 'zosia', 'marie', 'kathy', 'princess',
  // Windows
  'zira', 'hazel', 'aria', 'jenny', 'michelle', 'sonia', 'libby', 'natasha', 'emma', 'heera', 'neerja',
  'catherine', 'linda', 'heather', 'helena', 'hedda', 'katja', 'elsa', 'denise', 'julie', 'hortense',
  'haruka', 'ayumi', 'sabina', 'huihui', 'yaoyao', 'hanhan', 'kalpana', 'clara', 'ana', 'elena', 'irina',
]);

const MALE = new Set([
  // macOS
  'daniel', 'alex', 'tom', 'oliver', 'lee', 'rishi', 'aaron', 'arthur', 'gordon', 'evan', 'nathan', 'eddy',
  'grandpa', 'reed', 'rocko', 'fred', 'ralph', 'junior', 'albert', 'bruce', 'aman', 'aru', 'jorge', 'juan',
  'diego', 'thomas', 'luca', 'xander', 'yuri', 'maged', 'tarik', 'martin', 'jacques', 'felipe', 'otoya',
  'hattori', 'majed', 'neel', 'carlos',
  // Windows
  'david', 'mark', 'george', 'guy', 'ryan', 'brian', 'christopher', 'eric', 'roger', 'steffan', 'andrew',
  'prabhat', 'ravi', 'hemant', 'stefan', 'paul', 'pablo', 'raul', 'kangkang', 'ichiro', 'zhiwei', 'sean',
  'james', 'richard', 'valluvar', 'ivan', 'pavel',
]);

/** Sound effects and gimmicks: choosable by hand, never cast automatically. */
const NOVELTY = new Set([
  'bad news', 'good news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'jester', 'organ', 'pipe organ',
  'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'deranged', 'hysterical', 'albert', 'junior',
  'ralph', 'fred', 'kathy', 'princess',
]);

/** "Microsoft Zira Desktop - English (United States)" → "zira"; "Eddy (English (US))" → "eddy". */
function baseName(name: string): string {
  return name
    .replace(/^(microsoft|google|apple)\s+/i, '')
    .replace(/\s*[-(].*$/, '')
    .replace(/\s+(desktop|online|natural|enhanced|premium|compact)\b.*$/i, '')
    .trim()
    .toLowerCase();
}

export function voiceGender(name: string): 'female' | 'male' | undefined {
  const first = baseName(name).split(/\s+/)[0];
  if (FEMALE.has(first)) return 'female';
  if (MALE.has(first)) return 'male';
  return undefined;
}

export function isNoveltyVoice(name: string): boolean {
  const base = baseName(name);
  return NOVELTY.has(base);
}
