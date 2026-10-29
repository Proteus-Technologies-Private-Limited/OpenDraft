// Repro on main for PR #174's bugs: beat-link housekeeping dropped, and same-name suggesters.
// Both tests pass on main from before 8402f55, which shows the bugs; after it, the old
// API (string `by`) no longer type-checks. vitest only runs tests under frontend/src, so
// to run it, copy it there and adjust the imports (as suggestionGuard.test.ts does).
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from '@tiptap/pm/state';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { testSchema, block, doc } from '../frontend/src/test/screenplaySchema';
import { isHousekeeping, suggestTransaction, listSuggestions, resolveSuggestionTransaction } from '../frontend/src/editor/suggestions';
import { ensureSceneUid } from '../frontend/src/utils/beatScenes';
import { checkSuggesterUpdate, SCRIPT_FIELD } from '../collab-server/src/services/suggestionGuard';
import { updateYFragment } from 'y-prosemirror';

describe('main', () => {
  it('bug 2: linking a beat is housekeeping, so a suggester session drops it', () => {
    const s = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(block('sceneHeading', 'INT. ROOM - DAY'))) });
    const given = ensureSceneUid(s, 0)!;
    console.log('isHousekeeping(beat link tr) =', isHousekeeping(given.tr!));
    expect(isHousekeeping(given.tr!)).toBe(true);
  });

  it('bug 3: a second "Sam" passes the server check withdrawing the first Sam\'s suggestion', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment(SCRIPT_FIELD);
    prosemirrorJSONToYXmlFragment(testSchema, doc(block('action', 'Go.')), frag);
    let state = EditorState.create({ schema: testSchema, doc: yXmlFragmentToProseMirrorRootNode(frag, testSchema) });
    const meta = { mapping: new Map(), isOMark: new Map() };
    // Sam A suggests "Now"
    state = state.apply(suggestTransaction(state, state.tr.insertText('Now ', 1), { by: 'Sam', now: 1 }));
    ydoc.transact(() => updateYFragment(ydoc, frag, state.doc, meta as never));
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(ydoc));
    // Sam B withdraws it
    const id = listSuggestions(state.doc)[0].id;
    let update: Uint8Array | null = null;
    ydoc.on('update', (u: Uint8Array) => { update = u; });
    state = state.apply(resolveSuggestionTransaction(state, id, false)!);
    ydoc.transact(() => updateYFragment(ydoc, frag, state.doc, meta as never));
    const why = checkSuggesterUpdate(Y as never, server, update!, 'Sam');
    console.log('server verdict for other Sam withdrawing =', why);
    expect(why).toBeNull();
  });
});
