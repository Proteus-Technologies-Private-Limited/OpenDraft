/**
 * The single definition of a saveable script payload.
 *
 * A saved script is the TipTap document JSON with per-screenplay app state
 * spread alongside it as `_`-prefixed top-level keys. ProseMirror ignores the
 * extra keys, and the loader in ScreenplayEditor destructures them back out.
 *
 * This lived in two places (MenuBar and ScreenplayEditor) and the copies
 * DIVERGED: MenuBar's omitted the eight spelling/grammar keys, so a manual
 * Cmd+S overwrote the stored blob with a payload missing them and the settings
 * were silently reset on the next load. Everything that persists a script must
 * now go through this one function.
 *
 * Keep `SAVE_METADATA_KEYS` in step with the object built below — the backup
 * and .odraft round-trip tests assert the two agree.
 */
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { spellChecker } from '../editor/spellchecker';
import { grammarIgnore } from '../editor/grammar/grammarIgnore';

/**
 * Every `_`-prefixed key `buildSaveContent` writes. Used to separate app
 * metadata from the ProseMirror document without hand-maintaining a second
 * list at each read site.
 */
export const SAVE_METADATA_KEYS = [
  '_notes',
  '_generalNotes',
  '_tags',
  '_tagCategories',
  '_characterProfiles',
  '_characterRelationships',
  '_beats',
  '_beatColumns',
  '_beatArrangeMode',
  '_templateId',
  '_ignoredWords',
  '_ignoredOnce',
  '_customDictWords',
  '_enabledGlobalDicts',
  '_projectDictEnabled',
  '_enabledLanguages',
  '_ignoredGrammarRules',
  '_ignoredGrammarOnce',
  '_spellCheckEnabled',
  '_grammarCheckEnabled',
  '_sceneNumbersVisible',
  '_sceneNumbersLocked',
  '_pageLayout',
  '_sceneHeadingSpaceBefore',
] as const;

export type SaveMetadataKey = (typeof SAVE_METADATA_KEYS)[number];

/**
 * Build a saveable content object: editor JSON + store metadata at top level.
 * Returns undefined when there is no usable editor, which every caller treats
 * as "nothing to save" rather than "save an empty document".
 */
export function buildSaveContent(editor: Editor | null): Record<string, unknown> | undefined {
  if (!editor || editor.isDestroyed) return undefined;
  const store = useEditorStore.getState();
  const tplStore = useFormattingTemplateStore.getState();
  const doc = editor.getJSON();
  return {
    ...doc,
    _notes: store.notes,
    _generalNotes: store.generalNotes,
    _tags: store.tags,
    _tagCategories: store.tagCategories,
    _characterProfiles: store.characterProfiles,
    _characterRelationships: store.characterRelationships,
    _beats: store.beats,
    _beatColumns: store.beatColumns,
    _beatArrangeMode: store.beatArrangeMode,
    _templateId: tplStore.activeTemplateId,
    _ignoredWords: spellChecker.getIgnoredWords(),
    _ignoredOnce: spellChecker.getIgnoredOnce(),
    // Project dictionary lives on the Project entity now; keep the script
    // field empty so older clients don't show stale words after migration.
    _customDictWords: [],
    _enabledGlobalDicts: spellChecker.getEnabledGlobalDicts(),
    _projectDictEnabled: spellChecker.isProjectDictionaryEnabled(),
    _enabledLanguages: spellChecker.getEnabledLanguages(),
    _ignoredGrammarRules: grammarIgnore.getIgnoredRules(),
    _ignoredGrammarOnce: grammarIgnore.getIgnoredOnce(),
    _spellCheckEnabled: store.spellCheckEnabled,
    _grammarCheckEnabled: store.grammarCheckEnabled,
    _sceneNumbersVisible: store.sceneNumbersVisible,
    _sceneNumbersLocked: store.sceneNumbersLocked,
    _pageLayout: store.pageLayout,
    // Always written, even when null. Its *absence* is the signal that a
    // document predates the two-line scene-heading default, which is what the
    // spacing prompt keys off — so writing it unconditionally is what stops the
    // prompt reappearing after the writer has answered it.
    _sceneHeadingSpaceBefore: store.sceneHeadingSpaceBefore,
  };
}

/**
 * Split a stored payload into the ProseMirror document and the app metadata.
 * Neither half is mutated; unknown keys stay with the document, matching how
 * the existing destructuring load paths behave.
 */
export function stripSaveMetadata(
  content: Record<string, unknown> | null | undefined,
): { pmDoc: Record<string, unknown>; metadata: Partial<Record<SaveMetadataKey, unknown>> } {
  const pmDoc: Record<string, unknown> = {};
  const metadata: Partial<Record<SaveMetadataKey, unknown>> = {};
  if (!content || typeof content !== 'object') return { pmDoc, metadata };
  const known = new Set<string>(SAVE_METADATA_KEYS);
  for (const [key, value] of Object.entries(content)) {
    if (known.has(key)) metadata[key as SaveMetadataKey] = value;
    else pmDoc[key] = value;
  }
  return { pmDoc, metadata };
}

/**
 * True when a payload carries any of the `_`-prefixed app metadata. Import
 * paths use this to decide whether rehydrating the stores from a file would
 * restore real state or just wipe the current state with empties.
 */
export function hasSaveMetadata(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  return SAVE_METADATA_KEYS.some((key) => key in (content as Record<string, unknown>));
}
