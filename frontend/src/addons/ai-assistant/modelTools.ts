/**
 * The commands a model may call.
 *
 * An allow-list, one id at a time. A block-list was the wrong shape: plugins
 * register commands, and a command nobody reviewed would have been offered to
 * the model simply because it changed the text. Undo and redo stay out because
 * they change the document without producing anything to preview, so a reply
 * made only of them would look empty and then undo the writer's work when
 * accepted. Read-only commands are not actions either.
 *
 * A new command is refused until it is added here deliberately.
 */
import { commandTools, listCommands } from './commands';

/** Commands a model may run. Adding one is a decision, not an oversight. */
const FOR_MODEL: ReadonlySet<string> = new Set([
  'script.insertDialogue',
  'script.insertAction',
  'script.insertScene',
  'script.insertTransition',
  'script.insertParenthetical',
  'script.insertBlocks',
  'script.insertBlock',
  'editor.setElement',
  'editor.replaceSelection',
  'editor.insertText',
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
      .filter((command) => !command.readOnly && FOR_MODEL.has(command.id))
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
