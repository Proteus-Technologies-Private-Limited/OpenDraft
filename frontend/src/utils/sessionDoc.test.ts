import { describe, it, expect, beforeEach } from 'vitest';
import { stashSessionDoc, takeSessionDoc, clearSessionDoc } from './sessionDoc';

const DOC = { type: 'doc', content: [{ type: 'action' }] };

describe('sessionDoc', () => {
  beforeEach(() => clearSessionDoc());

  it('returns nothing when nothing was stashed', () => {
    expect(takeSessionDoc(null, null)).toBeNull();
  });

  it('round-trips a document for the same context', () => {
    stashSessionDoc({ doc: DOC, projectId: 'p1', scriptId: 's1' });
    expect(takeSessionDoc('p1', 's1')).toEqual(DOC);
  });

  it('handles a document that belongs to no project', () => {
    stashSessionDoc({ doc: DOC, projectId: null, scriptId: null });
    expect(takeSessionDoc(null, null)).toEqual(DOC);
  });

  it('consumes the stash so it cannot be restored twice', () => {
    stashSessionDoc({ doc: DOC, projectId: 'p1', scriptId: 's1' });
    expect(takeSessionDoc('p1', 's1')).toEqual(DOC);
    expect(takeSessionDoc('p1', 's1')).toBeNull();
  });

  it('refuses a different script, and leaves the stash intact', () => {
    stashSessionDoc({ doc: DOC, projectId: 'p1', scriptId: 's1' });
    expect(takeSessionDoc('p1', 's2')).toBeNull();
    expect(takeSessionDoc('p2', 's1')).toBeNull();
    expect(takeSessionDoc(null, null)).toBeNull();
    // Still there for the context it came from.
    expect(takeSessionDoc('p1', 's1')).toEqual(DOC);
  });

  it('forgets the document when cleared', () => {
    stashSessionDoc({ doc: DOC, projectId: null, scriptId: null });
    clearSessionDoc();
    expect(takeSessionDoc(null, null)).toBeNull();
  });
});
