import { describe, it, expect, vi } from 'vitest';
import {
  describeNetworkError,
  isLocalHost,
  normalizeBaseUrl,
  ollamaToolCalls,
  openaiToolCalls,
  parseJsonActions,
  toolResultMessage,
  type AiSettings,
} from './client';

// The LAN rule only applies to the desktop app, so keep isTauri deterministic.
vi.mock('../../services/platform', () => ({ isTauri: () => true }));

describe('normalizeBaseUrl', () => {
  it('drops trailing slashes', () => {
    expect(normalizeBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(normalizeBaseUrl('  http://localhost:8080/v1//  ')).toBe('http://localhost:8080/v1');
  });
});

describe('ollamaToolCalls', () => {
  it('reads object arguments', () => {
    expect(ollamaToolCalls([
      { function: { name: 'script_insertDialogue', arguments: { character: 'BEN', text: 'Ciao' } } },
    ])).toEqual([
      { name: 'script_insertDialogue', args: { character: 'BEN', text: 'Ciao' } },
    ]);
  });

  it('reads stringified arguments and skips nameless calls', () => {
    expect(ollamaToolCalls([
      { function: { name: 'editor_setElement', arguments: '{"type":"action"}' } },
      { function: { arguments: {} } },
      null,
    ])).toEqual([
      { name: 'editor_setElement', args: { type: 'action' } },
    ]);
  });

  it('returns nothing for a reply without calls', () => {
    expect(ollamaToolCalls(undefined)).toEqual([]);
    expect(ollamaToolCalls({})).toEqual([]);
  });
});

describe('openaiToolCalls', () => {
  it('reads the OpenAI tool_calls shape, string arguments included', () => {
    expect(openaiToolCalls([
      { id: 'call_1', function: { name: 'script_insertDialogue', arguments: '{"character":"BEN","text":"Ciao"}' } },
    ])).toEqual([
      { name: 'script_insertDialogue', args: { character: 'BEN', text: 'Ciao' } },
    ]);
  });
});

describe('parseJsonActions', () => {
  it('reads tool + args, with or without code fences', () => {
    expect(parseJsonActions('{"tool":"script.insertDialogue","args":{"character":"BEN","text":"Ciao"}}'))
      .toEqual([{ name: 'script.insertDialogue', args: { character: 'BEN', text: 'Ciao' } }]);
    expect(parseJsonActions('```json\n{"tool":"editor.undo"}\n```'))
      .toEqual([{ name: 'editor.undo', args: {} }]);
  });

  it('reads name + arguments', () => {
    expect(parseJsonActions('{"name":"editor_setElement","arguments":{"type":"dialogue"}}'))
      .toEqual([{ name: 'editor_setElement', args: { type: 'dialogue' } }]);
  });

  it('reads a list of actions', () => {
    expect(parseJsonActions(JSON.stringify({
      actions: [
        { tool: 'script.insertDialogue', args: { character: 'BEN', text: 'Ciao' } },
        { tool: 'editor.setElement', args: { type: 'action' } },
      ],
    }))).toHaveLength(2);
  });

  it('ignores prose and malformed JSON', () => {
    expect(parseJsonActions('Certo, lo faccio subito.')).toEqual([]);
    expect(parseJsonActions('{"tool":')).toEqual([]);
    expect(parseJsonActions('{"args":{"x":1}}')).toEqual([]);
  });
});

describe('toolResultMessage', () => {
  it('carries the tool name and the JSON result', () => {
    const message = toolResultMessage('script_insertDialogue', { ok: true, message: 'Fatto.' });
    expect(message.role).toBe('tool');
    expect(message.tool_name).toBe('script_insertDialogue');
    expect(JSON.parse(message.content)).toMatchObject({ ok: true });
  });
});

describe('isLocalHost', () => {
  it('accepts localhost and loopback addresses', () => {
    for (const url of [
      'http://localhost:11434',
      'http://127.0.0.1:8080/v1',
      'http://[::1]:1234',
    ]) {
      expect(isLocalHost(url), url).toBe(true);
    }
  });

  it('rejects a LAN address', () => {
    expect(isLocalHost('http://192.168.1.20:11434')).toBe(false);
    expect(isLocalHost('http://10.0.0.5:8080/v1')).toBe(false);
  });
});

describe('describeNetworkError', () => {
  const settings = (baseUrl: string): AiSettings => ({
    provider: 'openai',
    baseUrl,
    model: 'mock-model',
    apiKey: '',
  });

  it('explains the desktop localhost-only rule for a LAN server', () => {
    const message = describeNetworkError(
      settings('http://192.168.1.20:11434'),
      new TypeError('Failed to fetch'),
    );
    expect(message).toContain('192.168.1.20');
    expect(message).toContain('only allows plain-http connections to localhost');
    expect(message).not.toContain('OLLAMA_ORIGINS');
  });

  it('keeps the origin hint for a local server', () => {
    const message = describeNetworkError(
      settings('http://localhost:11434'),
      new TypeError('Failed to fetch'),
    );
    expect(message).toContain('OLLAMA_ORIGINS');
  });
});