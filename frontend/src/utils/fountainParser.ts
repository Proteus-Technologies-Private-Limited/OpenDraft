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

    // Synopsis line: starts with = (must follow a scene heading)
    if (trimmed.startsWith('= ') && nodes.length > 0 && nodes[nodes.length - 1].type === 'sceneHeading') {
      const prev = nodes[nodes.length - 1];
      if (!prev.attrs) prev.attrs = {};
      prev.attrs.synopsis = trimmed.substring(2).trim();
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
      let charName = trimmed.substring(1).trim();
      // Check for dual dialogue marker ^
      const isDual = charName.endsWith('^');
      if (isDual) charName = charName.replace(/\s*\^$/, '');
      const charNode = makeNode('character', charName);
      if (isDual) charNode.attrs = { ...charNode.attrs, dualDialogue: true };
      nodes.push(charNode);
      i++;
      i = collectDialogueBlock(lines, i, nodes);
      continue;
    }

    // Character: all uppercase, preceded by empty line
    if (isCharacterLine(trimmed.replace(/\s*\^$/, '')) && isPrecededByEmptyLine(lines, i)) {
      let charName = trimmed;
      const isDual = charName.endsWith('^');
      if (isDual) charName = charName.replace(/\s*\^$/, '').trim();
      const charNode = makeNode('character', charName);
      if (isDual) charNode.attrs = { ...charNode.attrs, dualDialogue: true };
      nodes.push(charNode);
      i++;
      i = collectDialogueBlock(lines, i, nodes);
      continue;
    }

    // Default: action
    nodes.push(makeNode('action', trimmed));
    i++;
  }

  // Post-process: merge dual dialogue pairs
  const merged = mergeDualDialogue(nodes);

  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [makeNode('action', '')],
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

const DIALOGUE_TYPES = new Set(['character', 'dialogue', 'parenthetical']);

/**
 * Post-process: find character nodes marked with dualDialogue=true and merge
 * the previous dialogue group with the current one into a dualDialogue container.
 */
function mergeDualDialogue(nodes: TipTapNode[]): TipTapNode[] {
  const result: TipTapNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'character' && node.attrs?.dualDialogue) {
      // This character starts the right column — find the previous dialogue group for the left column
      // Remove dualDialogue marker from attrs
      delete node.attrs!.dualDialogue;
      if (Object.keys(node.attrs!).length === 0) delete (node as any).attrs;

      // Collect right column: this character + following dialogue/parenthetical
      const rightCol: TipTapNode[] = [node];
      for (let j = i + 1; j < nodes.length; j++) {
        if (DIALOGUE_TYPES.has(nodes[j].type) && nodes[j].type !== 'character') {
          rightCol.push(nodes[j]);
          i = j;
        } else {
          i = j - 1;
          break;
        }
      }

      // Find previous dialogue group in result (walk backwards to find character)
      const leftCol: TipTapNode[] = [];
      while (result.length > 0) {
        const last = result[result.length - 1];
        if (DIALOGUE_TYPES.has(last.type)) {
          leftCol.unshift(result.pop()!);
        } else {
          break;
        }
      }

      if (leftCol.length > 0) {
        result.push({
          type: 'dualDialogue',
          content: [
            { type: 'dualDialogueColumn', content: leftCol },
            { type: 'dualDialogueColumn', content: rightCol },
          ],
        });
      } else {
        // No previous dialogue group found — just add nodes normally
        result.push(...rightCol);
      }
    } else {
      result.push(node);
    }
  }

  return result;
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
