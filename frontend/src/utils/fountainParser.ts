// Fountain markup format parser
// Spec: https://fountain.io/syntax

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

export function parseFountain(text: string): TipTapNode {
  const lines = text.split('\n');
  const nodes: TipTapNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // Forced scene heading: line starts with .
    if (trimmed.startsWith('.') && trimmed.length > 1 && trimmed[1] !== '.') {
      nodes.push(makeNode('sceneHeading', trimmed.substring(1).trim()));
      i++;
      continue;
    }

    // Scene heading: starts with INT., EXT., EST., INT/EXT., I/E.
    if (/^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/.test(trimmed.toUpperCase())) {
      nodes.push(makeNode('sceneHeading', trimmed));
      i++;
      continue;
    }

    // Forced transition: line starts with >
    if (trimmed.startsWith('>') && !trimmed.endsWith('<')) {
      nodes.push(makeNode('transition', trimmed.substring(1).trim()));
      i++;
      continue;
    }

    // Transition: all caps ending with TO:
    if (/^[A-Z\s]+TO:$/.test(trimmed)) {
      nodes.push(makeNode('transition', trimmed));
      i++;
      continue;
    }

    // Forced character: line starts with @
    if (trimmed.startsWith('@')) {
      const charName = trimmed.substring(1).trim();
      nodes.push(makeNode('character', charName));
      i++;
      // Collect dialogue/parentheticals after character
      i = collectDialogueBlock(lines, i, nodes);
      continue;
    }

    // Character: all uppercase, preceded by empty line
    // Check if previous was empty and this is all caps
    if (isCharacterLine(trimmed) && isPrecededByEmptyLine(lines, i)) {
      nodes.push(makeNode('character', trimmed));
      i++;
      // Collect dialogue/parentheticals after character
      i = collectDialogueBlock(lines, i, nodes);
      continue;
    }

    // Default: action
    nodes.push(makeNode('action', trimmed));
    i++;
  }

  return {
    type: 'doc',
    content: nodes.length > 0 ? nodes : [makeNode('action', '')],
  };
}

function makeNode(type: string, text: string): TipTapNode {
  if (text === '') {
    return { type, content: [] };
  }
  return {
    type,
    content: [{ type: 'text', text }],
  };
}

function isCharacterLine(line: string): boolean {
  // All uppercase, not empty, no lowercase letters
  const cleaned = line.replace(/\(.*\)/, '').trim();
  return cleaned.length > 0 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}

function isPrecededByEmptyLine(lines: string[], index: number): boolean {
  if (index === 0) return true;
  return lines[index - 1].trim() === '';
}

function collectDialogueBlock(lines: string[], i: number, nodes: TipTapNode[]): number {
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      break;
    }

    // Parenthetical
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      nodes.push(makeNode('parenthetical', trimmed));
      i++;
      continue;
    }

    // Dialogue
    nodes.push(makeNode('dialogue', trimmed));
    i++;
  }
  return i;
}
