/** Synthetic, deterministic content shared by browser checks and the typing profiler. */
const LOREM = 'The room is quiet except for the hum of the refrigerator and the slow tick of a clock nobody has bothered to reset since the power went out. Rain taps the glass.';
const LINE = 'I told you this was going to happen. I told you and you smiled at me like I was making it up, like it was a story I tell at parties.';
const NAMES = ['MARGARET', 'DEV', 'OFFICER KANE', 'LUCY', 'THE STRANGER', 'HOLLIS'];

export function screenplay(pages) {
  // ~9 blocks per page, a mixed feature.
  const blocks = [];
  const scenes = Math.max(1, Math.round(pages / 1.6));
  const perScene = Math.round((pages * 9) / scenes);
  for (let s = 0; s < scenes; s++) {
    blocks.push({ type: 'sceneHeading', content: [{ type: 'text', text: `${s % 3 ? 'INT.' : 'EXT.'} LOCATION ${s} - ${s % 2 ? 'DAY' : 'NIGHT'}` }] });
    for (let i = 0; i < perScene; i++) {
      if (i % 4 === 0) {
        blocks.push({ type: 'action', content: [{ type: 'text', text: LOREM.slice(0, 70 + ((i * 37 + s) % 90)) }] });
      } else {
        blocks.push({ type: 'character', content: [{ type: 'text', text: NAMES[(i + s) % NAMES.length] }] });
        if (i % 5 === 2) blocks.push({ type: 'parenthetical', content: [{ type: 'text', text: '(quietly)' }] });
        blocks.push({ type: 'dialogue', content: [{ type: 'text', text: LINE.slice(0, 40 + ((i * 13 + s) % 90)) }] });
      }
    }
    if (s % 6 === 5) blocks.push({ type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] });
  }
  return { type: 'doc', content: blocks };
}

