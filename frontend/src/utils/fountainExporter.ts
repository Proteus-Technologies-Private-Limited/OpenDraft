// Fountain format exporter
import type { JSONContent } from '@tiptap/react';

function getTextContent(node: JSONContent): string {
  if (!node.content) return '';
  return node.content
    .filter((c) => c.type === 'text')
    .map((c) => {
      let text = c.text || '';
      if (c.marks) {
        for (const mark of c.marks) {
          if (mark.type === 'bold') text = `**${text}**`;
          if (mark.type === 'italic') text = `*${text}*`;
          if (mark.type === 'underline') text = `_${text}_`;
        }
      }
      return text;
    })
    .join('');
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

    switch (node.type) {
      case 'titlePage':
        // Already handled above
        break;
      case 'sceneHeading':
        lines.push('');
        lines.push(text.toUpperCase());
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
        lines.push(text.toUpperCase());
        break;
      case 'parenthetical':
        lines.push(text.startsWith('(') ? text : `(${text})`);
        break;
      case 'dialogue':
        lines.push(text);
        lines.push('');
        break;
      case 'transition':
        lines.push('');
        lines.push(`> ${text}`);
        lines.push('');
        break;
      case 'shot':
        lines.push('');
        lines.push(text.toUpperCase());
        lines.push('');
        break;
      case 'newAct':
      case 'endOfAct':
      case 'showEpisode':
        lines.push('');
        lines.push(text.toUpperCase());
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
                const childText = getTextContent(child);
                if (child.type === 'character') {
                  lines.push('');
                  // Second column character gets ^ marker
                  lines.push(colIndex === 1 ? `${childText.toUpperCase()} ^` : childText.toUpperCase());
                } else if (child.type === 'parenthetical') {
                  lines.push(childText.startsWith('(') ? childText : `(${childText})`);
                } else if (child.type === 'dialogue') {
                  lines.push(childText);
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
