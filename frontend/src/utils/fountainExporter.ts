// Fountain format exporter
import type { JSONContent } from '@tiptap/react';
import { jsonBlockRuns, mergeRuns, singleLine } from './nodeText';
import { sanitizeExportFilename } from './exportFilename';
import { clampSectionLevel } from '../editor/extensions/Section';

/**
 * Escape the characters Fountain reads as emphasis markup, so text the writer
 * actually typed survives a re-import. Without this a line like `5 * 3 * 2`
 * comes back italic, and a stray `**` re-parses as bold.
 *
 * The spec's convention is the Markdown one — a leading backslash. The backslash
 * itself is escaped first, or escaping `*` would corrupt an existing `\`.
 */
function escapeFountain(text: string): string {
  return text.replace(/[\\*_]/g, (char) => `\\${char}`);
}

/**
 * Wrap `text` in emphasis delimiters, keeping any leading or trailing
 * whitespace *outside* them.
 *
 * Fountain requires the character adjacent to a delimiter to be non-space —
 * `**word **` is not bold, it is four literal asterisks around some text. A mark
 * applied over a selection that happened to include its trailing space must
 * therefore emit `**word** `, never `**word **`.
 *
 * A run that is entirely whitespace carries no emphasis worth encoding, so it is
 * returned untouched rather than becoming an empty `****`.
 */
function wrapEmphasis(text: string, delimiter: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match) return text;
  const [, lead, core, trail] = match;
  if (core === '') return text;
  return `${lead}${delimiter}${core}${delimiter}${trail}`;
}

/**
 * Marked-up text of a node. A hard break becomes a real newline: the Fountain
 * spec takes "every carriage return as intent", so a newline inside Action,
 * Dialogue, General or Lyrics is exactly the right encoding. Break runs are
 * never wrapped in emphasis delimiters.
 *
 * Runs are merged before marking up, so a block that arrived from FDX or OSF as
 * several same-styled runs emits one `**…**` pair rather than several abutting
 * ones. Bold is applied before italic so the two together produce the spec's
 * `***bold italic***`.
 */
function getTextContent(node: JSONContent, stripBold = false): string {
  if (!node.content) return '';
  return mergeRuns(jsonBlockRuns(node))
    .map((run) => {
      if (run.isBreak) return '\n';
      let text = escapeFountain(run.text);
      if (run.bold && !stripBold) text = wrapEmphasis(text, '**');
      if (run.italic) text = wrapEmphasis(text, '*');
      if (run.underline) text = wrapEmphasis(text, '_');
      return text;
    })
    .join('');
}

/**
 * Elements whose formatting template already renders them bold.
 *
 * Fountain cannot express "a bold scene heading": `**INT. HOUSE**` is no longer
 * a scene heading, because the spec allows nothing before the `INT`. FDX and
 * Fade In bold their headings by default, so their importers attach a real bold
 * mark to every one — emitting it would force a `.` onto every heading in the
 * file, and any reader that lost the force would see character cues instead.
 *
 * The boldness is presentational and the receiving application restores it from
 * its own element settings, so it is dropped rather than encoded. Mirrors
 * `TYPE_PROVIDED_BOLD` in docxImporter, which already made this call.
 */
const TYPE_PROVIDED_BOLD = new Set(['sceneHeading', 'newAct', 'endOfAct', 'showEpisode', 'shot']);

/**
 * Text for an element that must occupy exactly one line. A newline in a scene
 * heading, character cue, transition or act marker changes how Fountain parses
 * the block — a transition's `> ` prefix would stop applying, and a second line
 * under a cue would be read as dialogue. Collapse instead.
 */
function lineText(node: JSONContent): string {
  return singleLine(getTextContent(node, TYPE_PROVIDED_BOLD.has(node.type ?? '')));
}

/**
 * Text for a dialogue-family element. A hard break that produces an *empty*
 * line would terminate the dialogue block, because Fountain ends dialogue at a
 * blank line. Two trailing spaces is the spec's convention for "this blank line
 * is intentional, keep the block going".
 */
function dialogueText(node: JSONContent): string {
  return getTextContent(node)
    .split('\n')
    .map((line) => (line.trim() === '' ? '  ' : line))
    .join('\n');
}

// ── Forcing syntax ──────────────────────────────────────────────────────────
//
// Fountain infers an element's type from the shape of its line, so a line whose
// shape disagrees with the type we mean must carry a forcing character. These
// mirror the rules in fountainParser — keep the two in step.

/** Scene-heading prefixes the parser recognises without a forcing `.`. */
const SCENE_HEADING_RE = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/;

/** The parser's all-caps-ending-in-`TO:` transition heuristic. */
const TRANSITION_RE = /^[A-Z\s]+TO:$/;

/**
 * Leading characters the parser reads as a forcing sigil or block marker.
 *
 * `#` joined the list when Sections did: without it a line of Action that opens
 * with a hash — a hashtag, a scene number a writer typed by hand — came back as
 * a section heading and vanished from the printed page.
 */
const SIGIL_RE = /^[!~.>@=#]/;

/**
 * The opening of a Fountain note, which has no escape in the spec — so Action
 * containing one has to be forced with `!`, or the brackets and everything
 * between them are lifted out of the line as an annotation on the way back in.
 *
 * The boneyard's `/*` needs no equivalent: `escapeFountain` backslashes every
 * asterisk, so the marker can never survive into the output intact.
 */
const NOTE_MARKER_RE = /\[\[/;

/** Mirrors `isCharacterLine` in fountainParser. */
function parsesAsCharacter(line: string): boolean {
  const cleaned = line.replace(/\(.*\)/, '').trim();
  return cleaned.length > 0 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}

/**
 * Prefix `!` when a line of Action would otherwise be re-read as something
 * else. An all-caps line of description is the common case — without the force
 * it comes back as a character cue and everything under it becomes dialogue.
 *
 * Applied per line, because a hard break inside Action produces several lines
 * and the parser judges each one on its own.
 */
function actionText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      const ambiguous =
        SIGIL_RE.test(trimmed) ||
        NOTE_MARKER_RE.test(trimmed) ||
        SCENE_HEADING_RE.test(trimmed.toUpperCase()) ||
        TRANSITION_RE.test(trimmed) ||
        parsesAsCharacter(trimmed);
      return ambiguous ? `!${line}` : line;
    })
    .join('\n');
}

/**
 * A scene heading the parser would not recognise on its own — `47 EXT. FOO`,
 * `BLACK SCREEN` — needs the forcing period, or it re-imports as a character
 * cue and drags the following action into dialogue. The scene number is
 * re-attached in the spec's trailing `#…#` form rather than being dropped.
 */
function sceneHeadingLine(node: JSONContent): string {
  let heading = lineText(node).toUpperCase();
  const sceneNumber = node.attrs?.sceneNumber;
  if (typeof sceneNumber === 'string' && sceneNumber.trim() !== '') {
    heading = `${heading} #${sceneNumber.trim()}#`;
  }
  // `..X` is not a forced heading — the parser reads a second dot as literal —
  // so a heading that already opens with a period is left for the `!`-free path.
  if (!SCENE_HEADING_RE.test(heading) && !heading.startsWith('.')) {
    heading = `.${heading}`;
  }
  return heading;
}

/**
 * Fountain has no General element. Forced Action is the closest fit: Action is
 * the one element whose leading whitespace the spec says to retain ("tabs and
 * spaces are retained in Action elements"), and forcing every line stops
 * indented or all-caps General text being re-read as a cue.
 *
 * Unconditional rather than the `actionText` "only if ambiguous" test, because
 * General exists precisely to hold text that does not follow screenplay shape —
 * guessing which of its lines are safe is the behaviour the element opts out of.
 */
function generalText(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `!${line}`))
    .join('\n');
}

/**
 * Prefix `@` when a cue would not be recognised as one — a name with no letters
 * (`5`), or one shaped like a transition (`CUT TO:`).
 */
function characterLine(node: JSONContent, suffix = ''): string {
  const cue = lineText(node).toUpperCase();
  const needsForce = !parsesAsCharacter(cue) || TRANSITION_RE.test(cue) || SIGIL_RE.test(cue);
  return `${needsForce ? '@' : ''}${cue}${suffix}`;
}

/**
 * Elements that continue the dialogue block they are in.
 *
 * Fountain ends a dialogue block at a blank line, so a blank line may only be
 * written where the block is actually meant to end. The exporter used to put
 * one after every Dialogue node — and a speech is several nodes whenever it
 * came from the Fountain parser, which makes one node per line. Saved and
 * reopened, every line of a speech after the first came back as Action.
 */
const DIALOGUE_FAMILY = new Set(['dialogue', 'parenthetical', 'lyrics']);

/** Does the block after this one belong to the same dialogue block? */
function continuesDialogue(next: JSONContent | undefined): boolean {
  return !!next && DIALOGUE_FAMILY.has(next.type ?? '');
}

/**
 * The `=` lines for an element's synopsis.
 *
 * A synopsis is stored as one string and may hold several lines — the parser
 * files every `=` line it finds under the same heading. Each needs its own `=`
 * on the way out: a raw newline would end the synopsis and turn the rest into
 * Action.
 */
function synopsisLines(node: JSONContent): string[] {
  const synopsis = node.attrs?.synopsis;
  if (typeof synopsis !== 'string' || synopsis.trim() === '') return [];
  return synopsis.split('\n').map((line) => `= ${line.trim()}`);
}

export function exportFountain(doc: JSONContent): string {
  const lines: string[] = [];

  if (!doc.content) return '';

  // Extract title page metadata from titlePage nodes
  const titlePageMeta: Record<string, string> = {};
  for (const node of doc.content) {
    if (node.type === 'titlePage' && node.attrs?.field === 'title') {
      if (node.attrs.tpTitle) titlePageMeta['Title'] = node.attrs.tpTitle;
      if (node.attrs.tpWrittenBy) titlePageMeta['Author'] = node.attrs.tpWrittenBy;
      if (node.attrs.tpDraft) titlePageMeta['Draft date'] = node.attrs.tpDraftDate || node.attrs.tpDraft;
      if (node.attrs.tpContact) titlePageMeta['Contact'] = node.attrs.tpContact.replace(/\n/g, '\\n');
      if (node.attrs.tpCopyright) titlePageMeta['Copyright'] = node.attrs.tpCopyright;
      if (node.attrs.tpBasedOn) titlePageMeta['Credit'] = `Based on ${node.attrs.tpBasedOn}`;
      break;
    }
  }
  if (Object.keys(titlePageMeta).length > 0) {
    for (const [key, value] of Object.entries(titlePageMeta)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('');
  }

  doc.content.forEach((node, index) => {
    const text = getTextContent(node);
    const next = doc.content?.[index + 1];

    // A manual page break before this element — Fountain spells it `===`.
    if (node.attrs?.startsNewPage && node.type !== 'titlePage') {
      lines.push('');
      lines.push('===');
      lines.push('');
    }

    switch (node.type) {
      case 'titlePage':
        // Already handled above
        break;
      case 'screenplayImage':
        // Fountain is plain text — no image representation. Skip.
        break;
      case 'sceneHeading':
        lines.push('');
        lines.push(sceneHeadingLine(node));
        lines.push(...synopsisLines(node));
        lines.push('');
        break;
      case 'action':
        // Centred Action is Fountain's `>text<`, and the only way to say
        // "centred" in the format. Written as plain Action it came back flush
        // left, so the centring survived neither a save nor a re-open.
        if (node.attrs?.textAlign === 'center') {
          lines.push('');
          lines.push(`> ${singleLine(text).trim()} <`);
          lines.push('');
          break;
        }
        lines.push(actionText(text));
        lines.push('');
        break;
      // Fountain's two non-printing elements. Neither is Action: written as
      // Action a Section prints on the page it exists to stay off, which is
      // what issue #82 saw on the way in.
      case 'section': {
        const level = clampSectionLevel(node.attrs?.level);
        lines.push('');
        lines.push(`${'#'.repeat(level)} ${lineText(node)}`.trimEnd());
        lines.push(...synopsisLines(node));
        lines.push('');
        break;
      }
      case 'note':
        lines.push('');
        lines.push(`[[${text.trim()}]]`);
        lines.push('');
        break;
      case 'general':
        lines.push(generalText(text));
        lines.push('');
        break;
      case 'character':
        lines.push('');
        lines.push(characterLine(node));
        break;
      case 'parenthetical': {
        const p = lineText(node);
        lines.push(p.startsWith('(') ? p : `(${p})`);
        break;
      }
      case 'dialogue':
        lines.push(dialogueText(node));
        if (!continuesDialogue(next)) lines.push('');
        break;
      case 'transition':
        lines.push('');
        lines.push(`> ${lineText(node)}`);
        lines.push('');
        break;
      // Fountain has no Shot or act-marker element, so these round-trip as
      // Action either way. Forcing them keeps that downgrade honest: an
      // unforced all-caps line preceded by a blank one is a *character cue*,
      // which would silently pull the following paragraph into dialogue.
      case 'shot':
      case 'newAct':
      case 'endOfAct':
      case 'showEpisode':
        lines.push('');
        lines.push(actionText(lineText(node).toUpperCase()));
        lines.push('');
        break;
      case 'lyrics':
        lines.push(`~${text}`);
        break;
      case 'dualDialogue':
        if (node.content) {
          node.content.forEach((col, colIndex) => {
            if (col.type === 'dualDialogueColumn' && col.content) {
              col.content.forEach((child, childIndex) => {
                if (child.type === 'character') {
                  lines.push('');
                  // Second column character gets ^ marker — it must stay on the
                  // character line, which is why the cue is collapsed first.
                  lines.push(characterLine(child, colIndex === 1 ? ' ^' : ''));
                } else if (child.type === 'parenthetical') {
                  const p = lineText(child);
                  lines.push(p.startsWith('(') ? p : `(${p})`);
                } else if (child.type === 'dialogue') {
                  lines.push(dialogueText(child));
                  if (!continuesDialogue(col.content?.[childIndex + 1])) lines.push('');
                }
              });
            }
          });
        }
        break;
      default:
        lines.push(text);
        break;
    }
  });

  return lines.join('\n');
}

export async function downloadFountain(doc: JSONContent, title: string = 'Untitled') {
  const text = exportFountain(doc);
  const filename = `${sanitizeExportFilename(title)}.fountain`;
  const { saveFile } = await import('./fileOps');
  await saveFile(text, filename, [{ name: 'Fountain', extensions: ['fountain'] }]);
}
