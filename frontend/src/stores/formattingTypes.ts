/**
 * Type definitions for the formatting template system.
 */

import type { PageLayout } from './editorStore';



/** Formatting rules for a single element type within a template. */
export interface FormattingElementRule {
  /** For built-in: same as ElementType key; for custom: UUID */
  id: string;
  /** Display name shown in pickers and template editor */
  label: string;
  /** True for the 13 standard screenplay element types */
  isBuiltIn: boolean;
  /** Whether this element is available in the template */
  enabled: boolean;

  // ── Font ──
  fontFamily: string | null;  // font name or null = use default
  fontSize: number | null;    // points or null = use default (12pt)

  // ── Text style ──
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  textTransform: 'uppercase' | 'lowercase' | 'none';
  textColor: string | null;       // hex color or null = inherit
  backgroundColor: string | null; // hex color or null = transparent

  // ── Layout ──
  textAlign: 'left' | 'center' | 'right' | 'justify';
  marginTop: number;   // points
  leftIndent: number;  // inches (absolute from page left edge)
  rightIndent: number; // inches (absolute from page left edge)

  // ── Element flow ──
  nextOnEnter: string;      // element id to switch to on Enter
  nextOnTab: string | null; // element id to switch to on Tab, or null

  // ── Placeholder ──
  placeholder: string;

  // ── Format override ──
  /** When true (default), users can override non-template formatting in enforce mode.
   *  When false, ALL formatting is locked for this element type in enforce mode. */
  allowFormatOverride: boolean;
}

/** Template category: system templates are read-only, user templates are editable. */
export type TemplateCategory = 'system' | 'user';

/** A starter document node — minimal Tiptap-style JSON used to seed new scripts.
 *  Only the fields needed to insert plain blocks; full ProseMirror JSON is also accepted. */
export interface StarterNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<StarterNode | { type: 'text'; text: string }>;
}

/** A complete formatting template. */
export interface FormattingTemplate {
  id: string;
  name: string;
  description: string;
  /** 'enforce' = formatting locked; 'override' = user can change per-instance */
  mode: 'enforce' | 'override';
  /** 'system' = read-only standard template; 'user' = editable custom template */
  category: TemplateCategory;
  /** Formatting rules keyed by element id */
  rules: Record<string, FormattingElementRule>;
  createdAt: string;
  updatedAt: string;

  // ── Optional script-type extensions (added for multi-format support) ──

  /** Partial overrides for default page layout (page size, margins, header/footer). */
  pageLayout?: Partial<PageLayout>;
  /** Initial document content seeded when a new script is created with this template. */
  starterDocument?: StarterNode[];
  /** Pages-per-runtime metric for stats (60 = 1 min/page screenplay; 30 = 30 sec/page sitcom). */
  pageTimeSeconds?: number;
  /** Subset of title-page fields to display, in order. If unset, shows all default fields. */
  titlePageFields?: string[];
  /** Element ids that must start on a new page (e.g. sitcom: every sceneHeading). */
  forceBreakBefore?: string[];
  /** Multiplier for line-height in pagination computation (e.g. 2.0 for double-spaced sitcom dialogue). Keyed by element id. */
  lineHeightMultiplier?: Record<string, number>;
  /** Optional human-readable category for grouping in the format picker (e.g. "TV", "Stage", "Audio"). */
  scriptTypeGroup?: string;
  /** Short tagline shown in the format-picker card. */
  scriptTypeTagline?: string;
}

/**
 * One-line explanations of the less obvious elements, shown as a tooltip on
 * desktop and on press-and-hold on touch.
 *
 * The wording comes from the user manual, which has always explained these —
 * it just never reached the place where the choice is actually made. A writer
 * had to discover by experiment what "General" was for (issue #77), and the
 * same is true of Shot, Cast List and Show/Episode.
 *
 * Only elements whose name does not explain them are listed; Action, Character
 * and Dialogue need no gloss.
 */
export const ELEMENT_DESCRIPTIONS: Record<string, string> = {
  general:
    'Full-width text with no screenplay formatting, and indentation you type is kept. '
    + 'For anything that does not fit another element — onscreen records, archival entries, notes.',
  shot: 'A specific camera shot or angle within the current scene.',
  lyrics: 'Sung dialogue. Set in italics and kept with the dialogue block.',
  castList: 'The list of characters appearing in a scene or episode.',
  showEpisode: 'The show or episode title, centred at the top of a television script.',
  newAct: 'Marks the start of an act. Television formats start a new page here.',
  endOfAct: 'Marks the end of an act.',
  parenthetical: 'A short direction to the actor, in brackets inside a dialogue block.',
  transition: 'How the film moves to the next scene — CUT TO:, DISSOLVE TO:.',
  sceneHeading: 'Where and when a scene takes place — INT./EXT., location, time of day.',
};

/** The 13 built-in element type ids (matches ElementType union). */
export const BUILT_IN_ELEMENT_IDS: readonly string[] = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'general',
  'shot',
  'newAct',
  'endOfAct',
  'lyrics',
  'showEpisode',
  'castList',
] as const;

/**
 * Map from built-in element id to the CSS class used in screenplay.css.
 * Custom elements use 'custom-element' with data-custom-type attribute.
 */
export const ELEMENT_CSS_CLASS: Record<string, string> = {
  sceneHeading: 'scene-heading',
  action: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
  general: 'general',
  shot: 'shot',
  newAct: 'new-act',
  endOfAct: 'end-of-act',
  lyrics: 'lyrics',
  showEpisode: 'show-episode',
  castList: 'cast-list',
};

/** Sentinel ID for the industry standard template (never stored in DB). */
export const INDUSTRY_STANDARD_ID = '__industry_standard__';

/** Helper to create a default FormattingElementRule. */
export function createDefaultRule(
  id: string,
  label: string,
  isBuiltIn: boolean,
): FormattingElementRule {
  return {
    id,
    label,
    isBuiltIn,
    enabled: true,
    fontFamily: null,
    fontSize: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    textTransform: 'none',
    textColor: null,
    backgroundColor: null,
    textAlign: 'left',
    marginTop: 0,
    leftIndent: 1.50,
    rightIndent: 7.50,
    nextOnEnter: id,  // default: stay same type
    nextOnTab: null,
    placeholder: '',
    allowFormatOverride: true,
  };
}

// ── Title page elements ─────────────────────────────────────────────────────

/**
 * The title page's own elements, and why they are element types here at all.
 *
 * Final Draft does not give them any: inside a `.fdx` every title-page line is
 * `<Paragraph Type="General">`, positioned by alignment alone, which is why a
 * title page imported from one arrives as a run of General paragraphs. Fountain
 * goes the other way and names them — `Title:`, `Credit:`, `Author:`,
 * `Source:`, `Draft date:`, `Contact:`, `Copyright:`, `Notes:` — but only as
 * document metadata, with no formatting attached.
 *
 * OpenDraft already stores the semantic name on the node (`titlePage` with a
 * `field` attribute), so it has what Fountain has; what it lacked was any way
 * to say how each one should look. These ids give every field a template rule
 * of its own, so a writer can set the title in a display face at 24pt and leave
 * the contact block in Courier.
 *
 * The `titlePage:` prefix keeps them out of the element ids a document node can
 * take, so they can never be confused with a body element, and makes them easy
 * to keep out of the "change this paragraph to…" menus — a line of action is
 * not something you convert into a copyright notice.
 */
export const TITLE_PAGE_RULE_PREFIX = 'titlePage:';

/** Rule id for a title-page field, e.g. `title` → `titlePage:title`. */
export function titlePageRuleId(field: string): string {
  return `${TITLE_PAGE_RULE_PREFIX}${field}`;
}

/** The field name back out of a rule id, or null if it isn't one. */
export function titlePageFieldOf(ruleId: string): string | null {
  return ruleId.startsWith(TITLE_PAGE_RULE_PREFIX)
    ? ruleId.slice(TITLE_PAGE_RULE_PREFIX.length)
    : null;
}

export function isTitlePageRuleId(ruleId: string): boolean {
  return ruleId.startsWith(TITLE_PAGE_RULE_PREFIX);
}

/**
 * The fields a title page is built from, in the order they appear on the page.
 *
 * `date` carries the notes block — the name is what `buildTitlePageBlocks` has
 * always written, and renaming it would orphan every saved document, so the
 * label carries the truth instead.
 */
export const TITLE_PAGE_ELEMENTS: { field: string; label: string }[] = [
  { field: 'title', label: 'Title Page — Title' },
  { field: 'author', label: 'Title Page — Credit & Author' },
  { field: 'draft', label: 'Title Page — Draft & Date' },
  { field: 'contact', label: 'Title Page — Contact' },
  { field: 'copyright', label: 'Title Page — Copyright' },
  { field: 'date', label: 'Title Page — Notes' },
];
