/**
 * The assistant's right-sidebar panel.
 *
 * It is a small agent loop, not a chat that pastes text: the model is given the
 * command layer as tools, calls `script.insertDialogue` (or another command),
 * and the editor builds the cue and the line with the right formatting. When
 * the provider cannot call tools — Unsloth Studio, LM Studio, most local
 * OpenAI-compatible servers — the model is asked for one JSON action instead,
 * and the same command runs.
 *
 * Nothing reaches the script until the writer accepts the proposal, and the
 * accepted actions run as normal, undoable editor changes. Everything stays on
 * the machine: the panel only talks to the server configured in Settings →
 * Add-ons.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaRobot, FaPaperPlane, FaTrashAlt } from 'react-icons/fa';
import { ELEMENT_LABELS } from '../../stores/editorStore';
import {
  commandTools, createPreviewAdapter, createTiptapAdapter, executeCommand, getCommand,
  type PreviewOp, type ScriptContext,
} from './commands';
import { parseQuickDialogue } from './quickIntent';
import { parseQuickScene, parseSceneWithDialogue } from './quickScene';
import {
  callModel,
  parseJsonActions,
  type AiChatMessage,
  type AiToolCall,
} from './client';
import { loadSettings } from './settingsStore';
import './assistant.css';

/** Right-sidebar panels receive the editor; that is all this one needs. */
interface Props {
  editor: Editor | null;
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const EXAMPLES = [
  'Write a line for Ben: "Hello, everyone."',
  'Add a scene: INT. LAUNDRY - NIGHT, with an opening action.',
  'Have MARGO say "You shouldn\'t have come back" (whispering).',
];

const MAX_STEPS = 6;
const MAX_REPLY_CHARS = 12_000;

/**
 * A small local model gets confused by eleven similarly named tools. The
 * compact list keeps the ones that cover writing: dialogue (with the optional
 * parenthetical and extension), action, scene, transition, a generic block for
 * the remaining element types, the element change and replacing the selection.
 * The rest stay available to the command layer and to native-tool providers.
 */
const CORE_JSON_TOOLS = new Set([
  'script_insertDialogue',
  'script_insertAction',
  'script_insertScene',
  'script_insertTransition',
  'script_insertBlock',
  'editor_setElement',
  'editor_replaceSelection',
]);

/**
 * The instructions and the script context the model gets on every turn.
 *
 * A model that is told "use a tool, or JSON if you cannot" tends to answer
 * "Inserted …" after seeing an earlier confirmation in the conversation; then
 * nothing is inserted. It is told that the app does the inserting, and that
 * JSON is the reply only when no tools arrive.
 */
function systemPrompt(context: unknown, openAiCompatible: boolean): string {
  const tools = commandTools().tools
    .filter((tool) => !openAiCompatible || CORE_JSON_TOOLS.has(tool.function.name))
    .map((tool) => `- ${tool.function.name}: ${tool.function.description}`)
    .join('\n');
  return [
    'You are the assistant inside OpenDraft, a screenwriting app.',
    'Always reply in the same language the writer uses in their request. If the request is in Italian, reply in Italian; if it is in English, reply in English.',
    'Keep your replies short.',
    'Never translate the screenplay content: names, action and dialogue stay in the language the writer used.',
    'To change the script use the available tools. If you do not receive tools, reply ONLY with a valid JSON object, with no text around it. Never write sentences like "Done" or "Inserted": the app performs the actions.',
    'For a line: {"tool":"script_insertDialogue","args":{"character":"<NAME>","text":"<LINE>"}}',
    'For several actions: {"actions":[{"tool":"...","args":{...}}, ...]}.',
    'Use only names and lines contained in the request; do not copy the examples or reuse lines from previous turns.',
    'A line belongs to the character who says it in the request, even if new: do not replace it with a name from the context.',
    'If the request says "X says: ..." or "X: ...", it is dialogue: use script_insertDialogue with character X, never an action.',
    'Names written in the request are valid even if not yet in the context.',
    '',
    'Elements: sceneHeading (slugline), action, character (cue), dialogue, parenthetical, transition, shot, general, newAct, endOfAct, lyrics.',
    'Use the dedicated insert commands for scene, action, dialogue and transition. Use script_insertBlock for shot, general, newAct, endOfAct or lyrics.',
    'A new place or time is a NEW SCENE: use script_insertScene. "outside/inside", "int./ext.", "later", "day/night" are a scene heading, not a transition.',
    'Never use script_insertTransition unless the request explicitly asks for a transition (CUT TO, DISSOLVE, FADE...).',
    'When the request describes a whole scene, break it into ALL actions and lines, in order, without summarizing or omitting anything.',
    'If the request starts with inside/outside + place + day/night, the first action is script_insertScene with heading "INT. PLACE - DAY" (or "EXT." for outside).',
    'Any quoted line is dialogue, never part of an action. Attribute it to the character who says it (the subject before says/yells/replies/shouts/whispers) and use script_insertDialogue. Never put quotes inside an action text.',
    'Actions are what we see (enters, undresses, looks): one or more script_insertAction, with the full text, without cutting sentences.',
    'Do not add headings, indentation or capitals to the text: the app handles them.',
    'Do not invent characters that are not in the context unless asked.',
    '',
    'Examples (same shape, do not copy the content):',
    'Request: "Ada says: The door was open."',
    'Reply: {"tool":"script_insertDialogue","args":{"character":"ADA","text":"The door was open."}}',
    'Request: "Rain falls. Ada says: Close the door."',
    'Reply: {"actions":[{"tool":"script_insertAction","args":{"text":"Rain falls."}},{"tool":"script_insertDialogue","args":{"character":"ADA","text":"Close the door."}}]}',
    'Request: "INT. HOUSE - DAY, Ada enters angry. She sees Bo and yells: «Get out!» Bo replies: «No.»"',
    'Reply: {"actions":[{"tool":"script_insertScene","args":{"heading":"INT. HOUSE - DAY"}},{"tool":"script_insertAction","args":{"text":"Ada enters angry."}},{"tool":"script_insertAction","args":{"text":"She sees Bo."}},{"tool":"script_insertDialogue","args":{"character":"ADA","text":"Get out!"}},{"tool":"script_insertDialogue","args":{"character":"BO","text":"No."}}]}',
    'Request: "We are outside the house, a little later. Vilgax waits by the door."',
    'Reply: {"actions":[{"tool":"script_insertScene","args":{"heading":"EXT. HOUSE - LATER"}},{"tool":"script_insertAction","args":{"text":"Vilgax waits by the door."}}]}',
    '',
    'Tools:',
    tools,
    '',
    'Current context:',
    JSON.stringify(context ?? {}),
  ].join('\n');
}

function clampReply(text: string): string {
  return text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}…` : text;
}

let messageCounter = 0;
function messageId(): string {
  messageCounter += 1;
  try {
    return crypto.randomUUID();
  } catch {
    return `ai-${Date.now()}-${messageCounter}`;
  }
}

/** One step of a proposal, drawn the way it will land on the page. */
const PreviewOpView: React.FC<{ op: PreviewOp }> = ({ op }) => {
  if (op.kind === 'blocks') {
    return (
      <>
        {op.blocks.map((block, i) => (
          <div key={i} className={`ai-preview-block ai-preview-${block.type}`}>
            {block.type === 'character' && block.extension
              ? `${block.text} ${block.extension}`
              : block.text}
          </div>
        ))}
      </>
    );
  }
  if (op.kind === 'element') {
    return (
      <div className="ai-preview-note">
        Element → {ELEMENT_LABELS[op.type] ?? op.type}
      </div>
    );
  }
  if (op.kind === 'replace') {
    return (
      <div className="ai-preview-block ai-preview-replace">
        Replace with: {op.text}
        {op.element ? ` (${ELEMENT_LABELS[op.element] ?? op.element})` : ''}
      </div>
    );
  }
  return <div className="ai-preview-block ai-preview-text">{op.text}</div>;
};

const AssistantPanel: React.FC<Props> = ({ editor }) => {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  /** The model's proposal, waiting for Accept. Nothing has touched the script. */
  const [pending, setPending] = useState<{ calls: AiToolCall[]; ops: PreviewOp[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);

  // A request in flight when the panel closes must not land on a dead panel.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const tools = useMemo(() => commandTools(), []);

  const addMessage = useCallback((role: UiMessage['role'], content: string) => {
    setMessages((current) => [...current, { id: messageId(), role, content }].slice(-200));
  }, []);

  const resolveCommand = useCallback((name: string): string => {
    // The model may use the sanitised tool name (script_insertDialogue) or the
    // command id (script.insertDialogue); both resolve to the command id.
    return tools.commandForTool.get(name) ?? name;
  }, [tools]);

  const runCalls = useCallback((adapter: ReturnType<typeof createTiptapAdapter>, calls: AiToolCall[]) => {
    const lines: string[] = [];
    const failures: string[] = [];
    let applied = 0;
    for (const call of calls) {
      const result = executeCommand(resolveCommand(call.name), call.args, adapter);
      if (result.ok) {
        lines.push(result.message);
        applied++;
      } else {
        lines.push(`Could not: ${result.message}`);
        failures.push(result.message);
      }
    }
    return { lines, failures, applied };
  }, [resolveCommand]);

  /**
   * Run the calls against a dry-run adapter first. Valid ones become a
   * proposal the writer accepts; nothing reaches the script until then.
   */
  const stageCalls = useCallback((
    adapter: ReturnType<typeof createTiptapAdapter>,
    calls: AiToolCall[],
  ) => {
    const preview = createPreviewAdapter(adapter.context());
    const valid: AiToolCall[] = [];
    const failures: string[] = [];
    for (const call of calls) {
      const id = resolveCommand(call.name);
      if (getCommand(id)?.readOnly) continue;
      const before = preview.ops.length;
      const result = executeCommand(id, call.args, preview.adapter);
      if (result.ok) valid.push(call);
      else {
        failures.push(result.message);
        preview.ops.splice(before);
      }
    }
    if (valid.length === 0) {
      return { staged: false, lines: [] as string[], failures, count: 0 };
    }
    const blockCount = preview.ops.reduce(
      (count, op) => count + (op.kind === 'blocks' ? op.blocks.length : 1),
      0,
    );
    if (blockCount > 40) {
      return {
        staged: false,
        lines: [] as string[],
        failures: ['The proposal is too large (max 40 blocks). Try a more specific request.'],
        count: 0,
      };
    }
    // Always show the proposal: nothing reaches the script without the writer.
    setPending({ calls: valid, ops: preview.ops });
    return { staged: true, lines: [] as string[], failures, count: valid.length };
  }, [resolveCommand]);

  const acceptPending = useCallback(() => {
    if (!pending || !editor) return;
    const adapter = createTiptapAdapter(editor);
    const ran = runCalls(adapter, pending.calls);
    setPending(null);
    addMessage('assistant', ran.lines.join(' ') || 'Done.');
    if (ran.failures.length > 0) {
      setError(`Some actions were not applied: ${ran.failures.join(' ')}`);
    }
  }, [pending, editor, runCalls, addMessage]);

  const rejectPending = useCallback(() => {
    setPending(null);
    addMessage('assistant', 'Proposal discarded.');
  }, [addMessage]);

  const send = useCallback(async (promptArg?: string) => {
    const prompt = (promptArg ?? input).trim();
    if (!prompt || busy || !editor || editor.isDestroyed) return;
    const settings = loadSettings();
    setInput('');
    setError(null);
    setPending(null);
    addMessage('user', prompt);
    setBusy(true);

    try {
      const adapter = createTiptapAdapter(editor);
      const context = executeCommand('script.getContext', {}, adapter).data as ScriptContext | undefined;

      const finishStaged = (staged: ReturnType<typeof stageCalls>): boolean => {
        if (staged.count === 0) return false;
        if (staged.staged) addMessage('assistant', 'Proposal ready - review and confirm.');
        else addMessage('assistant', staged.lines.join(' ') || 'Done.');
        if (staged.failures.length > 0) {
          setError(`Some actions were not applied: ${staged.failures.join(' ')}`);
        }
        return true;
      };

      // A simple "X says: ..." is deterministic: no model, no waiting.
      const quick = parseQuickDialogue(prompt, context?.characters ?? []);
      if (quick) {
        const staged = stageCalls(adapter, [{
          name: 'script.insertDialogue',
          args: { character: quick.character, text: quick.text },
        }]);
        if (!finishStaged(staged)) {
          setError('I could not prepare the dialogue.');
          addMessage('assistant', 'I could not prepare the dialogue.');
        }
        return;
      }

      // Heading + quoted lines: split the beats here, keeping the writer's
      // language and the speakers they named.
      const script = parseSceneWithDialogue(prompt);
      if (script) {
        const staged = stageCalls(adapter, [{
          name: 'script.insertBlocks',
          args: { blocks: script.blocks },
        }]);
        if (!finishStaged(staged)) {
          setError('I could not prepare the scene.');
          addMessage('assistant', 'I could not prepare the scene.');
        }
        return;
      }

      // A new place or time is a scene, never a transition. The model kept
      // turning "we are outside the house, a little later" into CUT TO.
      const scene = parseQuickScene(prompt);
      if (scene) {
        const staged = stageCalls(adapter, [{
          name: 'script.insertScene',
          args: {
            heading: scene.heading,
            ...(scene.action ? { action: scene.action } : {}),
          },
        }]);
        if (!finishStaged(staged)) {
          setError('I could not prepare the scene.');
          addMessage('assistant', 'I could not prepare the scene.');
        }
        return;
      }

      if (!settings.baseUrl.trim() || !settings.model.trim()) {
        setError('Set the AI server and model in Settings → Add-ons first.');
        addMessage('assistant', 'Set the AI server and model in Settings → Add-ons first.');
        return;
      }

      const openAiCompatible = settings.provider !== 'ollama';
      // The OpenAI-compatible path sends no history: a small local model tends
      // to copy an earlier line instead of writing the new one. The prompt and
      // the context carry everything a command needs.
      const history: AiChatMessage[] = openAiCompatible
        ? []
        : messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-10)
          .map((m): AiChatMessage => ({ role: m.role, content: m.content }));
      const conversation: AiChatMessage[] = [
        { role: 'system', content: systemPrompt(context, openAiCompatible) },
        ...history,
        { role: 'user', content: prompt },
      ];

      const executed: string[] = [];
      for (let step = 0; step < MAX_STEPS; step++) {
        const reply = await callModel(settings, conversation, tools.tools);
        if (!mountedRef.current) return;
        if (import.meta.env.DEV) console.warn('[ai-assistant] reply', reply.content, reply.toolCalls);

        if (reply.toolCalls.length > 0) {
          if (finishStaged(stageCalls(adapter, reply.toolCalls))) return;
          // One correction: a small model sometimes names a transition where
          // the request described a new scene, or sends wrong parameters.
          const correction = await callModel(settings, [
            ...conversation,
            reply.assistantMessage,
            {
              role: 'user',
              content: 'The previous tool calls were invalid. A new place or time is script_insertScene; use script_insertTransition only for CUT TO, DISSOLVE or FADE. Reply with corrected tool calls.',
            },
          ], tools.tools);
          if (!mountedRef.current) return;
          if (correction.toolCalls.length > 0 && finishStaged(stageCalls(adapter, correction.toolCalls))) return;
          setError(`No valid actions: ${reply.toolCalls.map((c) => c.name).join(', ')}`);
          addMessage('assistant', 'No valid actions.');
          return;
        }

        // No native call: a JSON answer (OpenAI-compatible / local models) or
        // ordinary prose.
        const actions = parseJsonActions(reply.content);
        if (actions.length > 0) {
          if (finishStaged(stageCalls(adapter, actions))) return;
          // Nothing valid: give a small model one chance to correct the
          // parameters it got wrong (a missing `text`, an unknown element).
          const correction = await callModel(settings, [
            ...conversation,
            reply.assistantMessage,
            {
              role: 'user',
              content: 'The actions were not valid: parameters are missing or wrong. Reply again with ONLY valid JSON, using the schema parameters.',
            },
          ], []);
          if (!mountedRef.current) return;
          const corrected = parseJsonActions(correction.content);
          if (corrected.length > 0 && finishStaged(stageCalls(adapter, corrected))) return;
          setError('The model did not produce a valid action. Try rephrasing the request.');
          addMessage('assistant', 'No valid actions.');
          return;
        }

        if (openAiCompatible) {
          // One corrective turn: a small local model sometimes answers with a
          // confirmation (or prose) instead of the JSON action.
          const retry = await callModel(settings, [
            ...conversation,
            reply.assistantMessage,
            {
              role: 'user',
              content: 'The previous reply contained no JSON action. Reply again with ONLY the action JSON, with no text around it.',
            },
          ], []);
          if (!mountedRef.current) return;
          const retryActions = parseJsonActions(retry.content);
          if (retryActions.length > 0 && finishStaged(stageCalls(adapter, retryActions))) return;
          setError('The model did not return a JSON action. Try rephrasing or use a larger model.');
          addMessage('assistant', clampReply(retry.content || reply.content || 'No action received.'));
          return;
        }

        addMessage('assistant', clampReply(reply.content || executed.join(' ') || 'Done.'));
        return;
      }

      addMessage('assistant', executed.join(' ') || 'Reached the step limit without a final answer.');
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addMessage('assistant', `⚠️ ${message}`);
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        inputRef.current?.focus();
      }
    }
  }, [
    input, busy, editor, messages, tools, addMessage, stageCalls,
  ]);

  const previewBlockCount = pending
    ? pending.ops.reduce(
      (count, op) => count + (op.kind === 'blocks' ? op.blocks.length : 1),
      0,
    )
    : 0;

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <span className="ai-title"><FaRobot /> AI Assistant</span>
        <div className="ai-header-actions">
          <button
            className="ai-icon-btn"
            title="New conversation"
            onClick={() => { setMessages([]); setError(null); setPending(null); }}
            disabled={messages.length === 0 || busy}
          >
            <FaTrashAlt />
          </button>
        </div>
      </div>

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <p>Ask the assistant to write into the script. It uses the app&apos;s commands,
               so the text arrives already formatted.</p>
            {EXAMPLES.map((example) => (
              <button key={example} className="ai-example" onClick={() => void send(example)}>
                {example}
              </button>
            ))}
            <p className="ai-hint">The server and model are set in Settings → Add-ons.</p>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`ai-message ai-${message.role}`}>
            <div className="ai-message-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="ai-message-text">{message.content}</div>
          </div>
        ))}
        {busy && (
          <div className="ai-message ai-assistant">
            <div className="ai-message-role">Assistant</div>
            <div className="ai-message-text ai-thinking">Writing…</div>
          </div>
        )}
      </div>

      {pending && (
        <div className="ai-preview">
          <div className="ai-preview-header">
            <span>Proposal</span>
            <span className="ai-preview-count">
              {previewBlockCount} {previewBlockCount === 1 ? 'block' : 'blocks'}
            </span>
          </div>
          <div className="ai-preview-body">
            {pending.ops.map((op, i) => <PreviewOpView key={i} op={op} />)}
          </div>
          <div className="ai-preview-actions">
            <button className="ai-preview-accept" onClick={acceptPending}>Insert</button>
            <button className="ai-preview-reject" onClick={rejectPending}>Discard</button>
          </div>
        </div>
      )}

      {error && <div className="ai-error">{error}</div>}

      <div className="ai-composer">
        <textarea
          ref={inputRef}
          className="ai-input ai-textarea"
          rows={3}
          value={input}
          placeholder="e.g. Write a line for Ben: &quot;Hello, everyone.&quot;"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        <button
          className="ai-send"
          title="Send (Enter)"
          onClick={() => void send()}
          disabled={busy || !input.trim() || !editor}
        >
          <FaPaperPlane />
        </button>
      </div>
      {!editor && <div className="ai-error">Open a screenplay to use the assistant.</div>}
    </div>
  );
};

export default AssistantPanel;
