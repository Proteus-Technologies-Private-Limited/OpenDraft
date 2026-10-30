/**
 * The small language-model client the assistant panel uses.
 *
 * Two dialects, one message shape:
 *
 * - **Ollama** (`/api/chat`) takes native tools. Models that support tool calls
 *   return them in `message.tool_calls`; the assistant and tool messages are
 *   passed back as they came.
 * - **OpenAI-compatible** (`/v1/chat/completions`) covers Unsloth Studio
 *   (`http://localhost:8080/v1`), LM Studio, llama.cpp and any hosted endpoint.
 *   It sends the tools natively when the server accepts them (Unsloth Studio
 *   does). Servers that reject `tools` are retried without them, and the model
 *   answers with `{"tool":"script.insertDialogue","args":{...}}` instead.
 *
 * Nothing here knows about the editor or React. It sends messages, returns a
 * normalized reply, and turns a model's JSON into tool calls.
 */
import type { ToolDefinition } from '../../commands/types';

export type AiProviderKind = 'ollama' | 'openai';

export interface AiSettings {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on an Ollama assistant message that called tools. */
  tool_calls?: unknown;
  /** Present on an Ollama tool result. */
  tool_name?: string;
}

export interface AiToolCall {
  /** Sanitized tool name or command id, as the model wrote it. */
  name: string;
  args: Record<string, unknown>;
}

export interface AiReply {
  content: string;
  toolCalls: AiToolCall[];
  /** The assistant message to append to the conversation (Ollama needs it). */
  assistantMessage: AiChatMessage;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_UNSLOTH_URL = 'http://localhost:8080/v1';
export const DEFAULT_OPENAI_URL = 'http://localhost:1234/v1';

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function endpoint(settings: AiSettings): string {
  const base = normalizeBaseUrl(settings.baseUrl);
  return settings.provider === 'ollama'
    ? `${base}/api/chat`
    : `${base}/chat/completions`;
}

function describeNetworkError(settings: AiSettings, err: unknown): string {
  const base = normalizeBaseUrl(settings.baseUrl);
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `Could not reach ${base}. Check that the server is running and that the app's origin `
      + `is allowed (for Ollama: OLLAMA_ORIGINS=*; for Unsloth Studio: the server must be `
      + `listening on ${base}).`;
  }
  return `Model error: ${message}`;
}

async function readError(response: Response): Promise<string> {
  let body = '';
  try {
    body = (await response.text()).slice(0, 400);
  } catch {
    // The status alone still says something useful.
  }
  return `HTTP ${response.status}${body ? `: ${body}` : ''}`;
}

/** A readable error; 401/403 get the one instruction that fixes them. */
async function httpError(response: Response): Promise<Error> {
  if (response.status === 401 || response.status === 403) {
    return new Error(
      'The server requires an API key. Copy it from Unsloth Studio (or your server) and '
      + 'paste it into the "API key" field in the assistant settings.',
    );
  }
  return new Error(await readError(response));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

/** Normalize an Ollama tool_calls list. Exported for tests. */
export function ollamaToolCalls(raw: unknown): AiToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: AiToolCall[] = [];
  for (const entry of raw) {
    const fn = asRecord(asRecord(entry).function);
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) continue;
    calls.push({ name, args: parseArguments(fn.arguments) });
  }
  return calls;
}

/** Normalize an OpenAI-compatible tool_calls list. Exported for tests. */
export function openaiToolCalls(raw: unknown): AiToolCall[] {
  return ollamaToolCalls(raw);
}

async function callOllama(
  settings: AiSettings,
  messages: AiChatMessage[],
  tools: ToolDefinition[],
): Promise<AiReply> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: false,
    options: { temperature: 0.3, num_predict: 1200 },
  };
  if (tools.length > 0) body.tools = tools;
  let response = await fetch(endpoint(settings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A model without tool support answers 400/404 to `tools`; retry without
  // them, and the system prompt's JSON fallback takes over.
  if (!response.ok && tools.length > 0 && (response.status === 400 || response.status === 404)) {
    delete body.tools;
    response = await fetch(endpoint(settings), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  if (!response.ok) throw await httpError(response);
  const data = asRecord(await response.json());
  const message = asRecord(data.message);
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls = ollamaToolCalls(message.tool_calls);
  return {
    content,
    toolCalls,
    assistantMessage: {
      role: 'assistant',
      content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    },
  };
}

async function callOpenAICompatible(
  settings: AiSettings,
  messages: AiChatMessage[],
  tools: ToolDefinition[],
): Promise<AiReply> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    // Low temperature: in this mode the reply is a JSON action, not prose.
    temperature: 0.1,
    max_tokens: 1200,
    stream: false,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  let response = await fetch(endpoint(settings), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  // Unsloth Studio and some other local servers reject native tools; retry
  // without them, and the system prompt's JSON fallback takes over.
  if (!response.ok && tools.length > 0 && (response.status === 400 || response.status === 404)) {
    delete body.tools;
    delete body.tool_choice;
    response = await fetch(endpoint(settings), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
  if (!response.ok) throw await httpError(response);
  const data = asRecord(await response.json());
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  const content = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => asRecord(part).text).filter((t) => typeof t === 'string').join('')
      : '';
  return {
    content,
    toolCalls: openaiToolCalls(message.tool_calls),
    assistantMessage: { role: 'assistant', content },
  };
}

/** Send the conversation and return the model's reply, normalized. */
export async function callModel(
  settings: AiSettings,
  messages: AiChatMessage[],
  tools: ToolDefinition[] = [],
): Promise<AiReply> {
  if (!normalizeBaseUrl(settings.baseUrl)) throw new Error('Configure the local server URL.');
  if (!settings.model.trim()) throw new Error('Configure the model name.');
  try {
    return settings.provider === 'ollama'
      ? await callOllama(settings, messages, tools)
      : await callOpenAICompatible(settings, messages, tools);
  } catch (err) {
    if (err instanceof Error && /^HTTP /.test(err.message)) throw err;
    throw new Error(describeNetworkError(settings, err));
  }
}

/** Models the configured server offers, for the panel's model picker. */
export async function listModels(settings: AiSettings): Promise<string[]> {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) return [];
  const url = settings.provider === 'ollama' ? `${base}/api/tags` : `${base}/models`;
  const headers: Record<string, string> = {};
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw await httpError(response);
  const data = asRecord(await response.json());
  if (settings.provider === 'ollama') {
    return (Array.isArray(data.models) ? data.models : [])
      .map((m) => asRecord(m).name)
      .filter((name): name is string => typeof name === 'string');
  }
  return (Array.isArray(data.data) ? data.data : [])
    .map((m) => asRecord(m).id)
    .filter((id): id is string => typeof id === 'string');
}

/**
 * Read tool calls out of a JSON answer. Models that cannot call tools are asked
 * for one of:
 *
 *   {"tool":"script.insertDialogue","args":{...}}
 *   {"name":"script_insertDialogue","arguments":{...}}
 *   {"actions":[{"tool":...,"args":...}, ...]}
 *
 * Code fences are tolerated; anything that is not JSON gives no actions, so a
 * normal prose answer is shown as prose.
 */
export function parseJsonActions(content: string): AiToolCall[] {
  const text = content.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const one = (value: unknown): AiToolCall | null => {
    const record = asRecord(value);
    const name = typeof record.tool === 'string'
      ? record.tool
      : typeof record.name === 'string'
        ? record.name
        : typeof record.command === 'string'
          ? record.command
          : '';
    if (!name) return null;
    const args = parseArguments(record.args ?? record.arguments ?? record.params ?? {});
    return { name, args };
  };

  if (Array.isArray(parsed)) {
    return parsed.map(one).filter((call): call is AiToolCall => call !== null);
  }
  const record = asRecord(parsed);
  if (Array.isArray(record.actions)) {
    return record.actions.map(one).filter((call): call is AiToolCall => call !== null);
  }
  const single = one(record);
  return single ? [single] : [];
}

/** The Ollama chat message shape needs tool_name on a tool result. */
export function toolResultMessage(name: string, result: unknown): AiChatMessage {
  return { role: 'tool', content: JSON.stringify(result), tool_name: name };
}
