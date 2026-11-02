/**
 * The command layer: every action an assistant, a CLI or a future external
 * agent can take on a script, described once and executed anywhere.
 *
 * A command never touches React. It runs against an {@link EditorAdapter},
 * which is the small surface of the editor a command needs: read the context,
 * insert typed blocks, change the element, replace the selection, undo. The
 * TipTap implementation lives in tiptapAdapter.ts; a headless CLI can bring its
 * own adapter without pulling the editor in.
 *
 * Parameters are described as a JSON Schema so the same command can be handed
 * to a model as a tool, printed by a CLI, and validated before it runs.
 */

/** Elements a command may set or insert. */
export type CommandElement =
  | 'sceneHeading' | 'action' | 'character' | 'dialogue' | 'parenthetical'
  | 'transition' | 'general' | 'shot' | 'newAct' | 'endOfAct' | 'lyrics';

/** One typed paragraph to insert. */
export interface BlockSpec {
  type: CommandElement;
  /** Plain text. Newlines are flattened to spaces by the adapter. */
  text: string;
  /** Character extensions such as "(V.O.)", already in parentheses. */
  extension?: string;
}

/** What the editor currently has that a command or a model may need. */
export interface ScriptContext {
  /** Heading of the scene the caret is in, or null before the first one. */
  sceneHeading: string | null;
  /** Element of the paragraph the caret is in. */
  element: string;
  /** Text selected, empty when the selection is a caret. */
  selectionText: string;
  /** Text of the paragraph the caret is in. */
  paragraphText: string;
  /** True when that paragraph has no text, so an insertion may replace it. */
  paragraphEmpty: boolean;
  /** Character cues in the script, in first-use order. */
  characters: string[];
  /** Scene headings in the script, in order. */
  scenes: string[];
}

/**
 * The editor surface commands run against. Kept deliberately small: adding a
 * method here is adding something a command can do, and every implementation
 * (TipTap, a headless document, a test double) must then support it.
 */
export interface EditorAdapter {
  context: () => ScriptContext;
  /** Insert typed blocks at the caret, replacing an empty paragraph. */
  insertBlocks: (blocks: BlockSpec[]) => void;
  setElement: (type: CommandElement) => void;
  replaceSelection: (text: string, element?: CommandElement) => void;
  insertText: (text: string) => void;
  undo: () => void;
  redo: () => void;
}

export interface CommandParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: boolean;
}

export interface CommandResult {
  ok: boolean;
  /** A sentence shown to the writer and returned to a model. */
  message: string;
  /** Structured result, for a model or a CLI. */
  data?: unknown;
}

export interface CommandRunContext {
  adapter: EditorAdapter;
}

export interface CommandSpec {
  /** Stable id, e.g. `script.insertDialogue`. Never renamed casually. */
  id: string;
  /** Short human name, for menus, the assistant and `commands` output. */
  label: string;
  /** One sentence explaining when to use it, read by models too. */
  description: string;
  parameters: CommandParameterSchema;
  /** True when the command only reads: it never needs an insertion preview. */
  readOnly?: boolean;
  run: (context: CommandRunContext, args: Record<string, unknown>) => CommandResult;
}

/** A tool as OpenAI-compatible APIs and Ollama expect it. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: CommandParameterSchema;
  };
}
