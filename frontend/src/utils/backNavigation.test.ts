import { describe, it, expect } from 'vitest';
import { backToParent, plainBack } from './backNavigation';

describe('plainBack', () => {
  it('pops when there is something behind the current screen', () => {
    expect(plainBack(3, '/')).toEqual({ kind: 'pop' });
  });

  it('goes to the fallback from the first entry in the stack', () => {
    // issue #65: popping here is a no-op, and a WebView has no browser chrome
    // to escape with.
    expect(plainBack(0, '/')).toEqual({ kind: 'replace', to: '/' });
  });

  it('goes to the fallback when the stack depth is unknowable', () => {
    expect(plainBack(undefined, '/')).toEqual({ kind: 'replace', to: '/' });
  });
});

describe('backToParent', () => {
  it('pops when the entry behind the screen is the parent', () => {
    expect(backToParent('/projects', '/projects', 2)).toEqual({ kind: 'pop' });
  });

  it('replaces rather than pushes when the parent is not behind us', () => {
    // Pushing here is what closed the Projects loop in issue #66 — the screen
    // being left has to come off the stack.
    expect(backToParent(undefined, '/projects', 2)).toEqual({
      kind: 'replace',
      to: '/projects',
    });
  });

  it('replaces when we arrived from somewhere else entirely', () => {
    expect(backToParent('/settings', '/projects', 2)).toEqual({
      kind: 'replace',
      to: '/projects',
    });
  });

  it('replaces when the screen is the first entry in the stack', () => {
    // Deep link straight into a project: there is nothing to pop, but the
    // control still has to land on the projects list.
    expect(backToParent('/projects', '/projects', 0)).toEqual({
      kind: 'replace',
      to: '/projects',
    });
  });

  it('never leaves the screen it is leaving on the stack', () => {
    // The loop from issue #66, walked through: projects (0) → project (1) →
    // "← Projects" pops back to 0, so the list's own back control unwinds to
    // the editor instead of re-entering the project.
    expect(backToParent('/projects', '/projects', 1)).toEqual({ kind: 'pop' });
    expect(plainBack(0, '/')).toEqual({ kind: 'replace', to: '/' });
  });
});
