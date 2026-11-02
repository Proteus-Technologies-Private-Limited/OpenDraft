/**
 * The commands a model may call.
 *
 * Undo and redo change the document without producing anything to preview, so a
 * reply made only of them would look like an empty proposal and then undo the
 * writer's work when accepted. Read-only commands are not actions either. What
 * is left — inserting dialogue, action, scenes, blocks, changing the element,
 * replacing the selection — all produces something the preview can show.
 */
import { commandTools, listCommands } from './commands';

/** Commands that are never handed to a model, even though they change the text. */
const NOT_FOR_MODEL: ReadonlySet<string> = new Set([
  'editor.undo',
  'editor.redo',
  'script.getContext',
]);

export interface ModelTools {
  /** The tool list to send to the server, already filtered. */
  tools: ReturnType<typeof commandTools>['tools'];
  /** Sanitised tool name -> command id. */
  commandForTool: Map<string, string>;
  /** Command ids a reply may run. */
  allowed: ReadonlySet<string>;
}

export function modelTools(): ModelTools {
  const { tools, commandForTool } = commandTools();
  const allowed = new Set(
    listCommands()
      .filter((command) => !command.readOnly && !NOT_FOR_MODEL.has(command.id))
      .map((command) => command.id),
  );
  return {
    tools: tools.filter((tool) => {
      const id = commandForTool.get(tool.function.name);
      return id !== undefined && allowed.has(id);
    }),
    commandForTool,
    allowed,
  };
}

/** True when a tool name or command id from a reply may be run. */
export function isModelCommand(
  name: string,
  commandForTool: Map<string, string>,
  allowed: ReadonlySet<string>,
): boolean {
  return allowed.has(commandForTool.get(name) ?? name);
}
