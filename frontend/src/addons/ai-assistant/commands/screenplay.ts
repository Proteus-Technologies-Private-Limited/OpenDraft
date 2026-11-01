/**
 * The built-in screenplay commands.
 *
 * These are the semantic actions a model should use instead of pasting text:
 * `script.insertDialogue` knows that a cue comes before the line and that the
 * cue is capitalised, so the model only supplies the character and the words.
 * The editor, not the model, decides formatting.
 *
 * Every string is clamped and every id validated before it reaches the editor:
 * parameters arrive from a model, which is hostile input as far as the script
 * is concerned.
 */
import { registerCommand } from './registry';
import type { BlockSpec, CommandElement } from './types';

/**
 * The element types the page prints in capitals. Kept here (rather than in the
 * core's capitalisation module) so the add-on does not depend on a core
 * feature: an insertion is stored the way it will read.
 */
const UPPERCASE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList',
]);

function isUppercaseElement(type: string): boolean {
  return UPPERCASE_ELEMENT_TYPES.has(type);
}

const MAX_TEXT = 20_000;
const MAX_NAME = 80;
const MAX_PARENTHETICAL = 200;

const ELEMENTS: readonly CommandElement[] = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical',
  'transition', 'general', 'shot', 'newAct', 'endOfAct', 'lyrics',
];

/** A non-empty string, newlines flattened to spaces, capped. */
function textArg(args: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const raw = args[key];
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function elementArg(args: Record<string, unknown>, key: string): CommandElement | null {
  const raw = args[key];
  if (typeof raw !== 'string') return null;
  return (ELEMENTS as readonly string[]).includes(raw) ? (raw as CommandElement) : null;
}

/**
 * The first non-empty string among several names. Local models regularly use
 * `action` for an action's text or `line` for a dialogue's, even when the tool
 * schema says `text`; accepting the synonyms costs nothing and turns a
 * "required text" failure into the line the writer asked for.
 */
function firstText(
  args: Record<string, unknown>,
  keys: readonly string[],
  max = MAX_TEXT,
): string | null {
  for (const key of keys) {
    const text = textArg(args, key, max);
    if (text) return text;
  }
  return null;
}

/** "(V.O.)", "(v.o.)" and "V.O." all become "(V.O.)". */
function extensionArg(args: Record<string, unknown>): string | null {
  const raw = args.extension ?? args.cueExtension;
  if (typeof raw !== 'string') return null;
  const inner = raw.trim().replace(/^\((.*)\)$/, '$1').trim();
  if (!inner) return null;
  return `(${inner.slice(0, 40).toUpperCase()})`;
}

/** "beat" and "(beat)" both become "(beat)". */
function parentheticalArg(args: Record<string, unknown>): string | null {
  const raw = args.parenthetical ?? args.direction;
  if (typeof raw !== 'string') return null;
  const inner = raw.trim().replace(/^\((.*)\)$/, '$1').trim();
  if (!inner) return null;
  return `(${inner.slice(0, MAX_PARENTHETICAL)})`;
}

const TRANSITION_RE = /^(CUT|DISSOLVE|FADE|SMASH|MATCH|JUMP|WIPE|IRIS|INTERCUT|SPLIT|PUSH|STOCK|TIME CUT)\b/i;

/** A transition ends with a colon or starts with a transition verb. */
function looksLikeTransition(text: string): boolean {
  return /:\s*$/.test(text) || TRANSITION_RE.test(text);
}

const NO_PARAMS = { type: 'object' as const, properties: {}, additionalProperties: false };

export function registerScreenplayCommands(): void {
  registerCommand({
    id: 'script.insertDialogue',
    label: 'Insert dialogue',
    description:
      'Insert a character cue and a line of dialogue at the caret, correctly formatted. '
      + 'Use this whenever the writer asks for something a character says.',
    parameters: {
      type: 'object',
      properties: {
        character: { type: 'string', description: 'Speaking character name, e.g. "BEN".' },
        text: { type: 'string', description: 'The dialogue exactly as it should read.' },
        parenthetical: { type: 'string', description: 'Optional direction in parentheses, e.g. "whispering".' },
        extension: { type: 'string', description: 'Optional cue extension, e.g. "V.O." or "O.S.".' },
      },
      required: ['character', 'text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const character = firstText(args, ['character', 'name', 'speaker'], MAX_NAME);
      const text = firstText(args, ['text', 'line', 'dialogue']);
      if (!character) return { ok: false, message: 'A character name is required.' };
      if (!text) return { ok: false, message: 'The dialogue text is required.' };
      const extension = extensionArg(args);
      const parenthetical = parentheticalArg(args);
      const blocks: BlockSpec[] = [
        { type: 'character', text: character.toUpperCase(), extension: extension ?? undefined },
      ];
      if (parenthetical) blocks.push({ type: 'parenthetical', text: parenthetical });
      blocks.push({ type: 'dialogue', text });
      adapter.insertBlocks(blocks);
      return {
        ok: true,
        message: `Inserted ${character.toUpperCase()}${extension ? ` ${extension}` : ''}'s dialogue.`,
        data: { blocks },
      };
    },
  });

  registerCommand({
    id: 'script.insertAction',
    label: 'Insert action',
    description: 'Insert an action line (what we see happening) at the caret.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The action as it should read.' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const text = firstText(args, ['text', 'action', 'description']);
      if (!text) return { ok: false, message: 'The action text is required.' };
      adapter.insertBlocks([{ type: 'action', text }]);
      return { ok: true, message: 'Inserted the action line.', data: { blocks: [{ type: 'action', text }] } };
    },
  });

  registerCommand({
    id: 'script.insertScene',
    label: 'Insert scene',
    description:
      'Insert a scene heading (capitalised for you) and optionally the first action line, at the caret.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Scene heading, e.g. "INT. DINER - NIGHT".' },
        action: { type: 'string', description: 'Optional first action line of the scene.' },
      },
      required: ['heading'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const heading = firstText(args, ['heading', 'sceneHeading', 'slugline']);
      if (!heading) return { ok: false, message: 'A scene heading is required.' };
      const action = firstText(args, ['action', 'text', 'description']);
      const blocks: BlockSpec[] = [{ type: 'sceneHeading', text: heading.toUpperCase() }];
      if (action) blocks.push({ type: 'action', text: action });
      adapter.insertBlocks(blocks);
      return { ok: true, message: `Inserted the scene ${heading.toUpperCase()}.`, data: { blocks } };
    },
  });

  registerCommand({
    id: 'script.insertTransition',
    label: 'Insert transition',
    description: 'Insert a transition such as "CUT TO:" or "DISSOLVE TO:" at the caret.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The transition, e.g. "CUT TO:".' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const text = firstText(args, ['text', 'transition'], 200);
      if (!text) return { ok: false, message: 'The transition text is required.' };
      if (!looksLikeTransition(text)) {
        return {
          ok: false,
          message: `"${text}" is not a transition. A new place or time is a scene: use script.insertScene.`,
        };
      }
      adapter.insertBlocks([{ type: 'transition', text: text.toUpperCase() }]);
      return { ok: true, message: `Inserted the transition ${text.toUpperCase()}.` };
    },
  });

  registerCommand({
    id: 'script.insertParenthetical',
    label: 'Insert parenthetical',
    description: 'Insert a parenthetical direction, in parentheses, at the caret.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The direction, without parentheses.' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const text = firstText(args, ['text', 'parenthetical', 'direction'], MAX_PARENTHETICAL);
      if (!text) return { ok: false, message: 'The direction text is required.' };
      adapter.insertBlocks([{ type: 'parenthetical', text: `(${text.replace(/^\((.*)\)$/, '$1')})` }]);
      return { ok: true, message: 'Inserted the parenthetical.' };
    },
  });

  registerCommand({
    id: 'script.insertBlocks',
    label: 'Insert blocks',
    description:
      'Insert several screenplay blocks in one action: scene heading, action, character, '
      + 'dialogue, parenthetical, transition, shot, general, new act, end of act or lyrics.',
    parameters: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          description: 'The blocks to insert, in order.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: [...ELEMENTS] },
              text: { type: 'string' },
              extension: { type: 'string', description: 'Optional cue extension, e.g. "V.O.".' },
            },
            required: ['type', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['blocks'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const raw = args.blocks;
      if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, message: 'At least one block is required.' };
      }
      if (raw.length > 60) {
        return { ok: false, message: 'Too many blocks in one insertion (max 60).' };
      }
      const blocks: BlockSpec[] = [];
      for (const item of raw) {
        const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const type = elementArg(value, 'type');
        const text = firstText(value, ['text', 'line']);
        if (!type || !text) {
          return { ok: false, message: 'Every block needs a valid type and text.' };
        }
        const extension = extensionArg(value);
        blocks.push({
          type,
          text: isUppercaseElement(type) ? text.toUpperCase() : text,
          ...(type === 'character' && extension ? { extension } : {}),
        });
      }
      adapter.insertBlocks(blocks);
      return { ok: true, message: `Inserted ${blocks.length} blocks.`, data: { blocks } };
    },
  });

  registerCommand({
    id: 'script.insertBlock',
    label: 'Insert element',
    description:
      'Insert a block of any screenplay element type, including shot, general, new act, '
      + 'end of act and lyrics, which have no dedicated insert command.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...ELEMENTS], description: 'The element type to insert.' },
        text: { type: 'string', description: 'The text of the block.' },
      },
      required: ['type', 'text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const type = elementArg(args, 'type');
      const text = firstText(args, ['text', 'line']);
      if (!type) return { ok: false, message: 'A valid element type is required.' };
      if (!text) return { ok: false, message: 'The text is required.' };
      const value = isUppercaseElement(type) ? text.toUpperCase() : text;
      adapter.insertBlocks([{ type, text: value }]);
      return { ok: true, message: `Inserted ${type}.`, data: { type, text: value } };
    },
  });

  registerCommand({
    id: 'editor.setElement',
    label: 'Set element type',
    description: 'Change the element type of the paragraph the caret is in.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...ELEMENTS],
          description: 'The element type to apply.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const type = elementArg(args, 'type');
      if (!type) return { ok: false, message: 'A valid element type is required.' };
      adapter.setElement(type);
      return { ok: true, message: `Set the element to ${type}.` };
    },
  });

  registerCommand({
    id: 'editor.replaceSelection',
    label: 'Replace selection',
    description:
      'Replace the selected text with new text, optionally changing its element type. '
      + 'With no selection, inserts at the caret.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The replacement text.' },
        element: { type: 'string', enum: [...ELEMENTS], description: 'Optional element type for the result.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const text = firstText(args, ['text', 'line']);
      if (!text) return { ok: false, message: 'The replacement text is required.' };
      const element = elementArg(args, 'element');
      adapter.replaceSelection(text, element ?? undefined);
      return { ok: true, message: 'Replaced the selection.' };
    },
  });

  registerCommand({
    id: 'editor.insertText',
    label: 'Insert text',
    description: 'Type plain text at the caret without changing the element type.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to insert.' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ adapter }, args) => {
      const text = firstText(args, ['text', 'line']);
      if (!text) return { ok: false, message: 'The text is required.' };
      adapter.insertText(text);
      return { ok: true, message: 'Inserted the text.' };
    },
  });

  registerCommand({
    id: 'editor.undo',
    label: 'Undo',
    description: 'Undo the last edit.',
    parameters: NO_PARAMS,
    run: ({ adapter }) => {
      adapter.undo();
      return { ok: true, message: 'Undone.' };
    },
  });

  registerCommand({
    id: 'editor.redo',
    label: 'Redo',
    description: 'Redo the last undone edit.',
    parameters: NO_PARAMS,
    run: ({ adapter }) => {
      adapter.redo();
      return { ok: true, message: 'Redone.' };
    },
  });

  registerCommand({
    id: 'script.getContext',
    label: 'Read script context',
    description:
      'Read the current scene, element, selection, characters and scene list. '
      + 'Use it when you need to know where in the script you are before writing.',
    readOnly: true,
    parameters: NO_PARAMS,
    run: ({ adapter }) => {
      const context = adapter.context();
      return { ok: true, message: 'Read the script context.', data: context };
    },
  });
}
