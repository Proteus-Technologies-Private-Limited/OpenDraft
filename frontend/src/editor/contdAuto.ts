/**
 * Auto (CONT'D): decide which character cues should gain or lose the continued
 * marker. Pure logic, extracted from ScreenplayEditor so it can be tested
 * without a live editor — the component keeps only the transaction apply.
 *
 * Industry rule (Final Draft / WriterDuet / Fade In): append the continued
 * marker when the same character resumes speaking after action *within the same
 * scene*. A scene heading / transition resets continuation.
 *
 * Golden rule: the automation only ever adds or removes a marker it added
 * itself (`contdAuto`). A marker the writer typed is never touched.
 *
 * ## Hard breaks
 *
 * A cue containing a hard break is left completely alone. Rewriting it would
 * mean `insertText` over the whole inline range, which flattens the break into
 * plain text — destroying content the writer deliberately added. Such a cue is
 * pathological anyway. Its normalized name still participates in continuation
 * matching, so `JOHN<br>SMITH` and `JOHN SMITH` are recognized as one speaker.
 */
import { characterKey, singleLine } from '../utils/nodeText';

/** Elements that mark a new scene — they break dialogue continuation. */
export const CONTD_RESET_TYPES = new Set(['sceneHeading', 'transition', 'newAct', 'endOfAct']);

export interface ContdBlock {
  type: string;
  /** `node.textContent` — hard breaks appear as newlines. */
  text: string;
  /** Document offset of the node. */
  pos: number;
  /** `node.nodeSize`. The inline content range is derived from this, never
   *  from `text.length`, which is short by one per inline atom. */
  nodeSize: number;
  attrs: Record<string, unknown>;
}

export interface ContdChange {
  pos: number;
  /** Start of the block's inline content. */
  from: number;
  /** End of the block's inline content. */
  to: number;
  oldText: string | null;
  newText: string | null;
  attrs: Record<string, unknown> | null;
}

export function computeContdChanges(
  blocks: ContdBlock[],
  opts: { contdMarker: string },
): ContdChange[] {
  const contdMarker = opts.contdMarker.trim() || "(CONT'D)";
  const contdMarkerUpper = contdMarker.toUpperCase();

  const changes: ContdChange[] = [];
  let lastCharBase: string | null = null;
  let lastWasDialogue = false;

  for (const child of blocks) {
    if (child.type === 'character') {
      const base = characterKey(child.text);

      // A cue containing a hard break is never rewritten — see the module
      // comment. It still updates the continuation state so the speaker is
      // tracked correctly across it.
      if (child.text.includes('\n')) {
        lastCharBase = base;
        lastWasDialogue = false;
        continue;
      }

      const raw = singleLine(child.text).toUpperCase();
      // Detect the configured marker as well as the standard forms, so an
      // existing marker is recognised even if the text setting was changed.
      const hasContd = /\(CONT'D\)|\(CONT'D\)|\(CONTD\)/i.test(raw) || raw.includes(contdMarkerUpper);
      const contdAuto = child.attrs.contdAuto === true;
      const contdSuppressed = child.attrs.contdSuppressed === true;
      const shouldHaveContd = lastCharBase !== null && base === lastCharBase && !lastWasDialogue;

      const from = child.pos + 1;
      const to = child.pos + child.nodeSize - 1;
      const setText = (newText: string) =>
        changes.push({ pos: child.pos, from, to, oldText: child.text, newText, attrs: null });
      const setAttrs = (patch: Record<string, unknown>) =>
        changes.push({ pos: child.pos, from, to, oldText: null, newText: null, attrs: { ...child.attrs, ...patch } });

      if (shouldHaveContd && base) {
        if (contdSuppressed) {
          // Writer opted out here. If they re-typed the marker, respect it as
          // their own (manual) and forget the opt-out; otherwise leave the cue.
          if (hasContd) setAttrs({ contdSuppressed: false });
        } else if (!hasContd) {
          if (contdAuto) {
            // An auto marker was here and is now gone → writer removed it → remember.
            setAttrs({ contdSuppressed: true, contdAuto: false });
          } else {
            // Genuine first-time auto-add.
            setText(`${base} ${contdMarker}`);
            setAttrs({ contdAuto: true });
          }
        } else if (contdAuto && !raw.endsWith(contdMarkerUpper)) {
          // Present and auto-added, but the marker text was changed in settings →
          // normalise it to the configured text. Manually typed markers are left.
          setText(`${base} ${contdMarker}`);
        }
        // else hasContd && !suppressed: present (manual, or already correct) → leave it.
      } else {
        // Not a continuation here (different speaker, or after a scene reset).
        // Only strip a now-stale marker the automation itself added.
        if (hasContd && contdAuto) setText(base);
        if (contdAuto || contdSuppressed) setAttrs({ contdAuto: false, contdSuppressed: false });
      }

      lastCharBase = base;
      lastWasDialogue = false;
    } else if (child.type === 'dialogue' || child.type === 'parenthetical') {
      lastWasDialogue = true;
    } else {
      if (CONTD_RESET_TYPES.has(child.type)) {
        lastCharBase = null; // new scene / transition breaks dialogue continuation
      }
      lastWasDialogue = false;
    }
  }

  return changes;
}
