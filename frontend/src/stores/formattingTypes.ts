/**
 * Type definitions for the formatting template system.
 */



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
}

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
