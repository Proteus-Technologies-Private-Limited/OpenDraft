import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { block, doc, testSchema } from '../test/screenplaySchema';
import {
  SUGGEST_FORMAT,
  suggestTransaction,
  withoutSuggestionsJSON,
} from '../editor/suggestions';
import {
  prepareReviewSave,
  restoreReviewContent,
  prepareScriptWrite,
} from './reviewSave';
import { buildSaveContent, stripSaveMetadata } from './saveContent';
import { parseOdraft, serializeOdraft } from './odraftFormat';
import type { ScriptMeta } from '../services/api';
import { createFallbackStorage } from '../services/fallback-storage';
import {
  writeRecoverySnapshot,
  readRecoverySnapshot,
  clearRecoverySnapshot,
} from '../services/recoveryService';

const legacy = new Schema({
  nodes: testSchema.spec.nodes,
  marks: testSchema.spec.marks.remove(SUGGEST_FORMAT),
});
function proposed() {
  const state = EditorState.create({
    schema: testSchema,
    doc: testSchema.nodeFromJSON(doc(block('action', 'Keep every word.'))),
  });
  return state
    .apply(
      suggestTransaction(
        state,
        state.tr.addMark(1, 5, testSchema.marks.bold.create()),
        { by: 'Ann', uid: 'ann', now: 100 },
      ),
    )
    .doc.toJSON();
}

describe('review-safe persistence across old schemas', () => {
  it('puts accepted content in the body and full review in detached metadata', () => {
    const live = proposed();
    expect(() => legacy.nodeFromJSON(live)).toThrow();
    const before = JSON.stringify(live);
    const saved = prepareReviewSave({
      ...live,
      _notes: [{ id: 'note', content: 'Private' }],
    });
    expect(legacy.nodeFromJSON(saved).textContent).toBe('Keep every word.');
    expect(saved.content).toEqual(withoutSuggestionsJSON(live).content);
    expect(restoreReviewContent(saved).content).toEqual(live.content);
    expect(saved._notes).toEqual([{ id: 'note', content: 'Private' }]);
    expect(JSON.stringify(live)).toBe(before);
    expect(prepareReviewSave(saved)).toBe(saved);
    expect(restoreReviewContent(restoreReviewContent(saved))).toEqual(
      restoreReviewContent(saved),
    );
  });
  it('covers the common save builder and load splitter without modifying the editor', () => {
    const live = proposed();
    const editor = {
      isDestroyed: false,
      getJSON: () => live,
    } as unknown as Editor;
    const saved = buildSaveContent(editor)!;
    expect(legacy.nodeFromJSON(saved).textContent).toBe('Keep every word.');
    expect(stripSaveMetadata(saved).pmDoc.content).toEqual(live.content);
    expect(stripSaveMetadata(saved).pmDoc).not.toHaveProperty(
      '_reviewSnapshot',
    );
    expect(editor.getJSON()).toBe(live);
  });
  it('writes native files old apps can parse while current apps recover the proposals', () => {
    const live = proposed();
    const text = serializeOdraft({ title: 'Script' } as ScriptMeta, live);
    const olderPayload = JSON.parse(text).content;
    expect(legacy.nodeFromJSON(olderPayload).textContent).toBe(
      'Keep every word.',
    );
    expect(parseOdraft(text).content.content).toEqual(live.content);
    expect(stripSaveMetadata(parseOdraft(text).content).pmDoc.content).toEqual(
      live.content,
    );
  });
  it('never restores stale review data over edits made using an older version', () => {
    const saved = JSON.parse(JSON.stringify(prepareReviewSave(proposed())));
    saved.content = [block('action', 'Edited in the old application.')];
    expect(restoreReviewContent(saved).content).toEqual(saved.content);
    // An old writer normally drops unknown metadata on save altogether.
    delete saved._reviewSnapshot;
    expect(restoreReviewContent(saved)).toBe(saved);
  });
  it('ignores corrupt, tampered and newer sidecars without losing the accepted script', () => {
    const saved = JSON.parse(JSON.stringify(prepareReviewSave(proposed())));
    const corrupt = structuredClone(saved);
    corrupt._reviewSnapshot.baseline = 'wrong';
    const newer = structuredClone(saved);
    newer._reviewSnapshot.version = 999;
    const tampered = structuredClone(saved);
    tampered._reviewSnapshot.document.content = [block('action', 'Unrelated.')];
    for (const value of [corrupt, newer, tampered]) {
      expect(restoreReviewContent(value)).toBe(value);
      expect(legacy.nodeFromJSON(value).textContent).toBe('Keep every word.');
    }
  });
  it('preserves the baseline when a proposal removes an existing style', () => {
    const state = EditorState.create({
      schema: testSchema,
      doc: testSchema.nodeFromJSON(
        doc({
          type: 'action',
          content: [
            { type: 'text', text: 'Bold original.', marks: [{ type: 'bold' }] },
          ],
        }),
      ),
    });
    const live = state
      .apply(
        suggestTransaction(
          state,
          state.tr.removeMark(1, 5, testSchema.marks.bold),
          { by: 'Ann', now: 100 },
        ),
      )
      .doc.toJSON();
    const saved = prepareReviewSave(live);
    expect(
      legacy.nodeFromJSON(saved).firstChild?.firstChild?.marks[0].type.name,
    ).toBe('bold');
    expect(restoreReviewContent(saved).content).toEqual(live.content);
  });
  it('keeps both text and format reviews when they coexist in a saved document', () => {
    const state = EditorState.create({
      schema: testSchema,
      doc: testSchema.nodeFromJSON(proposed()),
    });
    const live = state
      .apply(
        suggestTransaction(state, state.tr.insertText('New ', 1), {
          by: 'Bea',
          now: 200,
        }),
      )
      .doc.toJSON();
    const saved = prepareReviewSave(live);
    expect(legacy.nodeFromJSON(saved).textContent).toBe('Keep every word.');
    expect(restoreReviewContent(saved).content).toEqual(live.content);
  });
  it('protects direct library imports and subsequent saves that bypass the common builder', async () => {
    const live = proposed();
    const api = createFallbackStorage();
    const project = await api.createProject('Review compatibility');
    const created = await api.createScript(project.id, {
      title: 'Script',
      content: live,
    });
    expect(legacy.nodeFromJSON(created.content).textContent).toBe(
      'Keep every word.',
    );
    const updated = await api.saveScript(project.id, created.meta.id, {
      content: live,
    });
    const read = await api.getScript(project.id, updated.meta.id);
    expect(legacy.nodeFromJSON(read.content).textContent).toBe(
      'Keep every word.',
    );
    expect(stripSaveMetadata(read.content).pmDoc.content).toEqual(live.content);
  });
  it('protects crash recovery bodies even when the caller supplies raw editor JSON', () => {
    clearRecoverySnapshot();
    const live = proposed();
    expect(
      writeRecoverySnapshot({
        title: 'Script',
        content: live,
        projectId: null,
        scriptId: null,
      }),
    ).toBe(true);
    const recovered = readRecoverySnapshot()!;
    expect(legacy.nodeFromJSON(recovered.content).textContent).toBe(
      'Keep every word.',
    );
    expect(stripSaveMetadata(recovered.content).pmDoc.content).toEqual(
      live.content,
    );
    clearRecoverySnapshot();
  });
  it('leaves existing text-only suggestions and non-document data unchanged', () => {
    const state = EditorState.create({
      schema: testSchema,
      doc: testSchema.nodeFromJSON(doc(block('action', 'One.'))),
    });
    const text = state
      .apply(
        suggestTransaction(state, state.tr.insertText('Two ', 1), {
          by: 'Ann',
          now: 100,
        }),
      )
      .doc.toJSON();
    expect(prepareReviewSave(text)).toBe(text);
    expect(prepareReviewSave(null)).toBeNull();
    expect(prepareReviewSave({ title: 'Metadata only' })).toEqual({
      title: 'Metadata only',
    });
    const rename: { title: string; content?: unknown } = { title: 'Rename' };
    expect(prepareScriptWrite(rename)).toEqual({ title: 'Rename' });
  });
});
