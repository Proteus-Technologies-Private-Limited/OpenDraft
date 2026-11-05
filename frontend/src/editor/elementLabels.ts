/**
 * Display text for element types. The ids (`sceneHeading`, `action` …) are what
 * documents store and never change; only the label shown in the UI is translated.
 * Calls t() at call time (never at import), so callers must re-render on a
 * language change — i.e. be inside a component that uses useTranslation().
 */
import { t } from '../i18n';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { ELEMENT_DESCRIPTIONS } from '../stores/formattingTypes';

/** Translated label for a built-in element id; the English constant for anything else. */
export function elementLabel(id: string, fallback?: string): string {
  try {
    switch (id) {
      case 'sceneHeading': return t('editor:elements.sceneHeading');
      case 'action': return t('editor:elements.action');
      case 'character': return t('editor:elements.character');
      case 'dialogue': return t('editor:elements.dialogue');
      case 'parenthetical': return t('editor:elements.parenthetical');
      case 'transition': return t('editor:elements.transition');
      case 'general': return t('editor:elements.general');
      case 'shot': return t('editor:elements.shot');
      case 'newAct': return t('editor:elements.newAct');
      case 'endOfAct': return t('editor:elements.endOfAct');
      case 'lyrics': return t('editor:elements.lyrics');
      case 'showEpisode': return t('editor:elements.showEpisode');
      case 'castList': return t('editor:elements.castList');
      case 'section': return t('editor:elements.section');
      case 'note': return t('editor:elements.note');
      case 'titlePage': return t('editor:elements.titlePage');
      default: return fallback ?? ELEMENT_LABELS[id] ?? id;
    }
  } catch (err) {
    console.warn('[i18n] element label lookup failed', id, err);
    return fallback ?? ELEMENT_LABELS[id] ?? id;
  }
}

/** Translated one-line description (tooltip) for an element id, if it has one. */
export function elementDescription(id: string): string | undefined {
  try {
    switch (id) {
      case 'general': return t('editor:elementDescriptions.general');
      case 'shot': return t('editor:elementDescriptions.shot');
      case 'lyrics': return t('editor:elementDescriptions.lyrics');
      case 'castList': return t('editor:elementDescriptions.castList');
      case 'showEpisode': return t('editor:elementDescriptions.showEpisode');
      case 'newAct': return t('editor:elementDescriptions.newAct');
      case 'endOfAct': return t('editor:elementDescriptions.endOfAct');
      case 'parenthetical': return t('editor:elementDescriptions.parenthetical');
      case 'transition': return t('editor:elementDescriptions.transition');
      case 'sceneHeading': return t('editor:elementDescriptions.sceneHeading');
      case 'section': return t('editor:elementDescriptions.section');
      case 'note': return t('editor:elementDescriptions.note');
      case 'avBlock': return t('editor:elementDescriptions.avBlock');
      default: return ELEMENT_DESCRIPTIONS[id];
    }
  } catch (err) {
    console.warn('[i18n] element description lookup failed', id, err);
    return ELEMENT_DESCRIPTIONS[id];
  }
}

/** Translated display name of a revision colour (the stored name, e.g. "2nd Blue", never changes). */
export function revisionColorLabel(name: string): string {
  try {
    switch (name) {
      case 'White': return t('editor:revisionColors.white');
      case 'Blue': return t('editor:revisionColors.blue');
      case 'Pink': return t('editor:revisionColors.pink');
      case 'Yellow': return t('editor:revisionColors.yellow');
      case 'Green': return t('editor:revisionColors.green');
      case 'Goldenrod': return t('editor:revisionColors.goldenrod');
      case 'Buff': return t('editor:revisionColors.buff');
      case 'Salmon': return t('editor:revisionColors.salmon');
      case 'Cherry': return t('editor:revisionColors.cherry');
      case '2nd Blue': return t('editor:revisionColors.secondBlue');
      case '2nd Pink': return t('editor:revisionColors.secondPink');
      case '2nd Yellow': return t('editor:revisionColors.secondYellow');
      case '2nd Green': return t('editor:revisionColors.secondGreen');
      default: return name;
    }
  } catch (err) {
    console.warn('[i18n] revision colour lookup failed', name, err);
    return name;
  }
}

/**
 * A template's placeholder hint, in the interface language when it is one of
 * the built-in descriptive hints. The templates keep these in English as data;
 * the format hints in capitals (CHARACTER NAME, CUT TO:) are screenplay
 * vocabulary and are shown as they are. Anything the writer typed is shown verbatim.
 */
export function templatePlaceholder(raw: string): string {
  try {
    switch (raw) {
      case 'Describe the action...': return t('editor:placeholders.describeAction');
      case 'Action description...': return t('editor:placeholders.actionDescription');
      case 'Dialogue...': return t('editor:placeholders.dialogue');
      case 'Text...': return t('editor:placeholders.general');
      case 'Lyrics...': return t('editor:placeholders.lyrics');
      case 'Cast...': return t('editor:placeholders.castList');
      case 'Body text...': return t('editor:placeholders.bodyText');
      case 'Pre-roll text...': return t('editor:placeholders.preRoll');
      case 'Section name (outline only)': return t('editor:placeholders.section');
      case 'Note (not printed)': return t('editor:placeholders.note');
      case 'What the artist draws in this panel...': return t('editor:placeholders.panelDescription');
      default: return raw;
    }
  } catch (err) {
    console.warn('[i18n] placeholder lookup failed', err);
    return raw;
  }
}
