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

  for (const node of doc.content) {
    const text = getTextContent(node);

    switch (node.type) {
      case 'sceneHeading':
        lines.push('');
        lines.push(text.toUpperCase());
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
      default:
        lines.push(text);
        break;
    }
  }

  return lines.join('\n');
}

export function downloadFountain(doc: JSONContent, title: string = 'Untitled') {
  const text = exportFountain(doc);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '')}.fountain`;
  a.click();
  URL.revokeObjectURL(url);
}
