/**
 * Restore the `_`-prefixed app metadata from an imported `.odraft` payload.
 *
 * A saved script is the document plus notes, tags, beats, character profiles
 * and layout, all carried as `_`-prefixed top-level keys (see
 * `utils/saveContent.ts`). Loading a script from the library restores all of
 * them; importing an `.odraft` file did not, so an imported backup came back
 * as bare text with every note and tag silently dropped.
 *
 * Scope note: this covers the metadata that lives purely in `editorStore` and
 * the template store. The script-load path in ScreenplayEditor additionally
 * rehydrates per-document dictionary and grammar state, which is entangled
 * with project-dictionary migration I/O and is deliberately not duplicated
 * here — spell/grammar preferences fall back to the current defaults on
 * import, which is the pre-existing behaviour.
 */
import { useEditorStore, DEFAULT_TAG_CATEGORIES, DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { hasSaveMetadata } from './saveContent';

/**
 * Some payloads store these as JSON strings rather than arrays/objects,
 * depending on which backend wrote them.
 */
function parseAttr<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Apply an imported payload's metadata to the stores.
 *
 * Returns false and changes nothing when the payload carries no metadata —
 * importing a v1 file or a bare document must never wipe the state the user
 * already has with empty defaults.
 */
export function hydrateEditorStoresFromContent(
  content: Record<string, unknown> | null | undefined,
): boolean {
  if (!content || !hasSaveMetadata(content)) return false;

  const store = useEditorStore.getState();
  const c = content as Record<string, any>;

  store.setNotes(parseAttr(c._notes, []));
  store.setGeneralNotes(parseAttr(c._generalNotes, []));
  store.setTags(parseAttr(c._tags, []));
  store.setTagCategories(parseAttr(c._tagCategories, DEFAULT_TAG_CATEGORIES));
  store.setCharacterProfiles(parseAttr(c._characterProfiles, []));
  store.setCharacterRelationships(parseAttr(c._characterRelationships, []));
  store.setBeats(parseAttr(c._beats, []));
  store.setBeatColumns(parseAttr(c._beatColumns, []));
  if (c._beatArrangeMode !== undefined) {
    store.setBeatArrangeMode(parseAttr<'auto' | 'custom'>(c._beatArrangeMode, 'auto'));
  }
  if (c._sceneNumbersVisible !== undefined) {
    store.setSceneNumbersVisible(c._sceneNumbersVisible === true);
  }
  if (c._sceneNumbersLocked !== undefined) {
    store.setSceneNumbersLocked(c._sceneNumbersLocked === true);
  }
  if (c._pageLayout !== undefined) {
    store.setPageLayout(parseAttr(c._pageLayout, DEFAULT_PAGE_LAYOUT));
  }

  if (typeof c._templateId === 'string' && c._templateId) {
    try {
      useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
    } catch (err) {
      console.warn('[import] could not apply template', c._templateId, err);
    }
  }

  return true;
}
