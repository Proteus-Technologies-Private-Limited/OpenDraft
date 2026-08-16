/**
 * Space before each element — shared by the editor's pagination plugin, the PDF
 * and DOCX exporters, and the scene navigator, so all four agree on where a
 * page ends.
 *
 * Each of those used to carry its own copy of the same literal map, and the
 * formatting template's per-element `marginTop` reached none of them: it was
 * emitted to CSS only. A writer who changed "Margin Top" in the Template Editor
 * saw a taller gap on screen while page breaks, the PDF and the DOCX all stayed
 * where they were. This module is the one place the value is resolved.
 *
 * Spacing is counted in 12pt lines, because that is the unit pagination works
 * in — a page holds a whole number of them.
 */

import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { useEditorStore } from '../stores/editorStore';
import { hasSaveMetadata } from './saveContent';

export const LINE_HEIGHT_PT = 12;

/**
 * The industry-standard space before a scene heading, in points — two blank
 * 12pt lines.
 *
 * Final Draft's Screenplay template ships with Space Before = 2 for Scene
 * Heading and its knowledge base calls that standard format. OpenDraft's own
 * FDX and OSF exporters have always *written* two lines (`SpaceBefore="24"`,
 * `spacebefore="2.0"`) while the editor rendered and paginated one, so a script
 * exported to Final Draft came out longer than OpenDraft showed.
 */
export const STANDARD_SCENE_HEADING_SPACE_PT = 24;

/**
 * Fallback when no template is available — a headless export, or a store that
 * has not hydrated. Mirrors the industry-standard template's values so the two
 * cannot drift.
 */
export const DEFAULT_SPACE_BEFORE: Record<string, number> = {
  sceneHeading: 2, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
};

/** The subset of a formatting template this module reads. */
export interface SpaceBeforeSource {
  rules?: Record<string, { marginTop?: number } | undefined>;
}

// Resolved per template object: pagination recomputes on every document change,
// so this must not rebuild the map on each keystroke.
const cache = new WeakMap<object, Record<string, number>>();

/**
 * Space before each element, in lines, for a given template.
 *
 * A rule's `marginTop` is in points and wins where it exists; anything the
 * template does not define falls back to {@link DEFAULT_SPACE_BEFORE}. Values
 * are rounded to whole lines — pagination cannot place an element half a line
 * down, and letting a fractional value through would drift the page break away
 * from where the editor draws it.
 */
export function buildSpaceBefore(tpl: SpaceBeforeSource | null | undefined): Record<string, number> {
  if (!tpl?.rules) return DEFAULT_SPACE_BEFORE;
  const cached = cache.get(tpl as object);
  if (cached) return cached;
  const resolved: Record<string, number> = { ...DEFAULT_SPACE_BEFORE };
  for (const [id, rule] of Object.entries(tpl.rules)) {
    if (typeof rule?.marginTop === 'number') {
      resolved[id] = Math.max(0, Math.round(rule.marginTop / LINE_HEIGHT_PT));
    }
  }
  cache.set(tpl as object, resolved);
  return resolved;
}

/**
 * Space before each element for the active template.
 *
 * Read lazily and defensively, matching `getForceBreakIds` in pageBreaks.ts:
 * an exporter must still produce a document when the template store has not
 * been hydrated (tests, headless export).
 */
export function getSpaceBefore(): Record<string, number> {
  try {
    const fromTemplate = buildSpaceBefore(
      useFormattingTemplateStore.getState().getActiveTemplate(),
    );
    const override = useEditorStore.getState().sceneHeadingSpaceBefore;
    if (typeof override !== 'number') return fromTemplate;
    // A document pinned to its original spacing (see the store field's note).
    // Copied rather than mutated — the template map is memoized and shared.
    return {
      ...fromTemplate,
      sceneHeading: Math.max(0, Math.round(override / LINE_HEIGHT_PT)),
    };
  } catch (err) {
    console.warn('[elementSpacing] could not read template spacing, using defaults', err);
    return DEFAULT_SPACE_BEFORE;
  }
}

/**
 * Does this saved payload predate the two-line scene-heading default?
 *
 * Only a payload that carries app metadata can be judged: a bare document, or
 * one imported from FDX or Fountain, has no OpenDraft spacing history and is
 * simply given the current standard. For everything else the *absence* of
 * `_sceneHeadingSpaceBefore` dates the file, because every save since the change
 * writes the key even when it is null.
 */
export function predatesStandardSceneSpacing(content: unknown): boolean {
  if (!hasSaveMetadata(content)) return false;
  return !('_sceneHeadingSpaceBefore' in (content as Record<string, unknown>));
}

/**
 * The scene-heading override a loaded payload should be opened with.
 *
 * A document written before the change is pinned to the one blank line it was
 * composed against, so opening it does not silently repaginate the draft; the
 * writer is then asked once whether to adopt the standard (see
 * {@link predatesStandardSceneSpacing}). Anything else uses its stored answer,
 * with `null` meaning "follow the template".
 */
export function resolveSceneHeadingSpaceBefore(content: unknown): number | null {
  if (predatesStandardSceneSpacing(content)) return LINE_HEIGHT_PT;
  const stored = (content as Record<string, unknown> | null)?.['_sceneHeadingSpaceBefore'];
  return typeof stored === 'number' ? stored : null;
}
