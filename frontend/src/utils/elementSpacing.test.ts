import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SPACE_BEFORE,
  STANDARD_SCENE_HEADING_SPACE_PT,
  buildSpaceBefore,
  getSpaceBefore,
  predatesStandardSceneSpacing,
} from './elementSpacing';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import { useEditorStore } from '../stores/editorStore';

beforeEach(() => {
  useEditorStore.getState().setSceneHeadingSpaceBefore(null);
});

describe('industry-standard scene-heading spacing', () => {
  it('is two blank lines, matching Final Draft', () => {
    expect(INDUSTRY_STANDARD_TEMPLATE.rules.sceneHeading.marginTop)
      .toBe(STANDARD_SCENE_HEADING_SPACE_PT);
    expect(buildSpaceBefore(INDUSTRY_STANDARD_TEMPLATE).sceneHeading).toBe(2);
  });

  it('agrees with what the FDX and OSF exporters write', () => {
    // fdxExporter emits SpaceBefore="24" and osfExporter spacebefore="2.0" for
    // Scene Heading. The editor used to render one line against both.
    expect(STANDARD_SCENE_HEADING_SPACE_PT / 12).toBe(2);
  });

  it('falls back to the same value with no template', () => {
    expect(buildSpaceBefore(null).sceneHeading).toBe(DEFAULT_SPACE_BEFORE.sceneHeading);
    expect(DEFAULT_SPACE_BEFORE.sceneHeading).toBe(2);
  });
});

describe('buildSpaceBefore reads the template', () => {
  it('converts a rule marginTop from points to lines', () => {
    const tpl = { rules: { action: { marginTop: 36 } } };
    expect(buildSpaceBefore(tpl).action).toBe(3);
  });

  it('keeps defaults for elements the template does not define', () => {
    const tpl = { rules: { action: { marginTop: 36 } } };
    expect(buildSpaceBefore(tpl).character).toBe(DEFAULT_SPACE_BEFORE.character);
  });

  it('rounds to whole lines — pagination cannot place half a line', () => {
    expect(buildSpaceBefore({ rules: { action: { marginTop: 17 } } }).action).toBe(1);
    expect(buildSpaceBefore({ rules: { character: { marginTop: 19 } } }).character).toBe(2);
  });

  it('never returns a negative', () => {
    expect(buildSpaceBefore({ rules: { action: { marginTop: -24 } } }).action).toBe(0);
  });
});

describe('per-document override', () => {
  it('is not applied when unset', () => {
    expect(getSpaceBefore().sceneHeading).toBe(2);
  });

  it('pins a document to its original one-line spacing', () => {
    useEditorStore.getState().setSceneHeadingSpaceBefore(12);
    expect(getSpaceBefore().sceneHeading).toBe(1);
  });

  it('leaves other elements on the template values', () => {
    useEditorStore.getState().setSceneHeadingSpaceBefore(12);
    expect(getSpaceBefore().action).toBe(DEFAULT_SPACE_BEFORE.action);
  });

  it('does not mutate the memoized template map', () => {
    useEditorStore.getState().setSceneHeadingSpaceBefore(12);
    getSpaceBefore();
    useEditorStore.getState().setSceneHeadingSpaceBefore(null);
    expect(getSpaceBefore().sceneHeading).toBe(2);
  });
});

describe('predatesStandardSceneSpacing', () => {
  it('is false for a bare document with no app metadata', () => {
    // An FDX or Fountain import has no OpenDraft spacing history.
    expect(predatesStandardSceneSpacing({ type: 'doc', content: [] })).toBe(false);
  });

  it('is true for a saved document written before the change', () => {
    expect(predatesStandardSceneSpacing({ type: 'doc', _pageLayout: {}, _notes: [] })).toBe(true);
  });

  it('is false once the key is present, even as null', () => {
    expect(predatesStandardSceneSpacing({
      type: 'doc', _pageLayout: {}, _sceneHeadingSpaceBefore: null,
    })).toBe(false);
  });

  it('is false for a document already pinned to the old spacing', () => {
    // The writer answered "keep" — they must not be asked again.
    expect(predatesStandardSceneSpacing({
      type: 'doc', _pageLayout: {}, _sceneHeadingSpaceBefore: 12,
    })).toBe(false);
  });

  it('is false for null or a non-object', () => {
    expect(predatesStandardSceneSpacing(null)).toBe(false);
    expect(predatesStandardSceneSpacing('nope')).toBe(false);
  });
});
