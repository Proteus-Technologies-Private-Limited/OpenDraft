/**
 * The command layer's entry point.
 *
 * Importing this module registers the built-in commands exactly once. The
 * assistant, the menus (as they adopt commands) and a future CLI/MCP server all
 * go through here, so they see the same set and the same behaviour.
 */
import { registerScreenplayCommands } from './screenplay';

let registered = false;

/** Register the built-in commands. Idempotent. */
export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;
  registerScreenplayCommands();
}

registerBuiltinCommands();

export { registerCommand, listCommands, getCommand, executeCommand, commandTools, toolNameFor } from './registry';
export { createTiptapAdapter } from './tiptapAdapter';
export { createPreviewAdapter } from './preview';
export type { PreviewAdapter, PreviewOp } from './preview';
export type {
  BlockSpec,
  CommandElement,
  CommandParameterSchema,
  CommandResult,
  CommandRunContext,
  CommandSpec,
  EditorAdapter,
  ScriptContext,
  ToolDefinition,
} from './types';
