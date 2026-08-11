// Fountain format exporter
import type { JSONContent } from '@tiptap/react';
import { jsonBlockRuns, singleLine } from './nodeText';

/**
 * Marked-up text of a node. A hard break becomes a real newline: the Fountain
 * spec takes "every carriage return as intent", so a newline inside Action,
 * Dialogue, General or Lyrics is exactly the right encoding. Break runs are
 * never wrapped in emphasis delimiters.
 */
function getTextContent(node: JSONContent): string {
  if (!node.content) return '';
  return jsonBlockRuns(node)
    .map((run) => {
      if (run.isBreak) return '\n';
      let text = run.text;
      if (run.bold) text = `**${text}**`;
      if (run.italic) text = `*${text}*`;
      if (run.underline) text = `_${text}_`;
      return text;
    })
    .join('');
}

/**
 * Text for an element that must occupy exactly one line. A newline in a scene
 * heading, character cue, transition or act marker changes how Fountain parses
 * the block — a transition's `> ` prefix would stop applying, and a second line
 * under a cue would be read as dialogue. Collapse instead.
 */
function lineText(node: JSONContent): string {
  return singleLine(getTextContent(node));
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

  for (const node of doc.content) {
    const text = getTextContent(node);

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
        lines.push(lineText(node).toUpperCase());
        if (node.attrs?.synopsis) {
          lines.push(`= ${node.attrs.synopsis}`);
        }
        lines.push('');
        break;
      case 'action':
        lines.push(text);
        lines.push('');
        break;
      case 'general':
        lines.push(text);
        break;
      case 'character':
        lines.push('');
        lines.push(lineText(node).toUpperCase());
        break;
      case 'parenthetical': {
        const p = lineText(node);
        lines.push(p.startsWith('(') ? p : `(${p})`);
        break;
      }
      case 'dialogue':
        lines.push(dialogueText(node));
        lines.push('');
        break;
      case 'transition':
        lines.push('');
        lines.push(`> ${lineText(node)}`);
        lines.push('');
        break;
      case 'shot':
        lines.push('');
        lines.push(lineText(node).toUpperCase());
        lines.push('');
        break;
      case 'newAct':
      case 'endOfAct':
      case 'showEpisode':
        lines.push('');
        lines.push(lineText(node).toUpperCase());
        lines.push('');
        break;
      case 'lyrics':
        lines.push(`~${text}`);
        break;
      case 'dualDialogue':
        if (node.content) {
          node.content.forEach((col, colIndex) => {
            if (col.type === 'dualDialogueColumn' && col.content) {
              for (const child of col.content) {
                if (child.type === 'character') {
                  const cue = lineText(child).toUpperCase();
                  lines.push('');
                  // Second column character gets ^ marker — it must stay on the
                  // character line, which is why the cue is collapsed first.
                  lines.push(colIndex === 1 ? `${cue} ^` : cue);
                } else if (child.type === 'parenthetical') {
                  const p = lineText(child);
                  lines.push(p.startsWith('(') ? p : `(${p})`);
                } else if (child.type === 'dialogue') {
                  lines.push(dialogueText(child));
                  lines.push('');
                }
              }
            }
          });
        }
        break;
      default:
        lines.push(text);
        break;
    }
  }

  return lines.join('\n');
}

export async function downloadFountain(doc: JSONContent, title: string = 'Untitled') {
  const text = exportFountain(doc);
  const filename = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '')}.fountain`;
  const { saveFile } = await import('./fileOps');
  await saveFile(text, filename, [{ name: 'Fountain', extensions: ['fountain'] }]);
}
