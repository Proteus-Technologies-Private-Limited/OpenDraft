/**
 * The command registry: one list of commands, shared by the assistant, the
 * menus (as they adopt it) and any future CLI or MCP server.
 *
 * Registration is explicit, in commands/index.ts, so a command cannot appear
 * in one surface and be missing from another by accident.
 */
import type {
  CommandResult,
  CommandSpec,
  EditorAdapter,
  ToolDefinition,
} from './types';

const registry = new Map<string, CommandSpec>();

/** Register a command. Registering the same id twice replaces it, so a
 *  consumer (a test, a plugin) can override one deliberately. */
export function registerCommand(spec: CommandSpec): void {
  registry.set(spec.id, spec);
}

export function listCommands(): CommandSpec[] {
  return Array.from(registry.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function getCommand(id: string): CommandSpec | undefined {
  return registry.get(id);
}

/**
 * Execute a command by id. Unknown ids and thrown errors become a failed
 * result, never an exception: a model must get an answer it can read.
 */
export function executeCommand(
  id: string,
  args: Record<string, unknown> | null | undefined,
  adapter: EditorAdapter,
): CommandResult {
  const command = registry.get(id);
  if (!command) {
    return { ok: false, message: `Unknown command: ${id}` };
  }
  try {
    const result = command.run({ adapter }, args && typeof args === 'object' ? args : {});
    if (!result || typeof result.ok !== 'boolean' || typeof result.message !== 'string') {
      return { ok: false, message: `Command ${id} returned no result` };
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Command ${id} failed: ${message}` };
  }
}

/** A model tool name: OpenAI requires letters, digits, `_` and `-` only. */
export function toolNameFor(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * The tool list for a model, plus the map back from the sanitised tool name to
 * the command id (dots became underscores on the way out).
 */
export function commandTools(): {
  tools: ToolDefinition[];
  commandForTool: Map<string, string>;
} {
  const commandForTool = new Map<string, string>();
  const tools = listCommands().map((command) => {
    const name = toolNameFor(command.id);
    commandForTool.set(name, command.id);
    return {
      type: 'function' as const,
      function: {
        name,
        description: command.description,
        parameters: command.parameters,
      },
    };
  });
  return { tools, commandForTool };
}
