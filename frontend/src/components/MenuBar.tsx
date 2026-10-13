import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, printedPageNumber, resolveHeaderFooter } from '../stores/editorStore';
import type { DocumentOrigin } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { requestHandwriting } from '../utils/handwriting';
import { requestElementMenu } from '../utils/elementMenu';
import { isInAvRow, isInAvCell, avCellSideAt, avRowContext, readColumnConfig, avColumnDataCount, avBlockAtSelection, AV_DEFAULT_COLUMNS, AV_ASPECT_RATIOS, AV_BLANK_FRAME } from '../editor/extensions/AvBlock';
import { avCellElementRules, scriptBodyElementRules } from '../utils/avCellElements';
import { chooseAvFrameImage } from '../utils/avFrame';
import { formatShortcut } from '../utils/shortcuts';
import { showToast } from './Toast';
import { downloadFDX } from '../utils/fdxExporter';
import { downloadFountain } from '../utils/fountainExporter';
import { exportFadeIn } from '../utils/osfExporter';
import {
  serializeContentForFormat, extensionOfPath, linkedFileName,
} from '../utils/linkedFileFormat';
import { useLinkedFileStore, autoSaveAppliesToOpenDocument } from '../stores/linkedFileStore';
import { exportPDF, renderPDF, type PDFExportOptions } from '../utils/pdfExporter';
import { buildExportFootnotePlan } from '../utils/exportFootnotes';
import { downloadDocx } from '../utils/docxExporter';
import { parseDocx } from '../utils/docxImporter';
import { pasteAsFountain } from '../utils/pasteFountain';
import { copySelection, cutSelection, pasteIntoEditor } from '../utils/clipboardCommands';
import {
  parseScreenplayImport,
  resetStoresForImport,
  SCREENPLAY_IMPORT_FILTERS,
  BINARY_IMPORT_EXTENSIONS,
} from '../utils/importScreenplay';
import { trackChangesPluginKey } from '../editor/trackChanges';
import PageSetupDialog from './PageSetupDialog';
import TemplateSelectDialog from './TemplateSelectDialog';
import ScriptFormatPreferencesDialog from './ScriptFormatPreferencesDialog';
import ScriptFormatPickerDialog from './ScriptFormatPickerDialog';
import { useFormattingTemplateStore, ensureTemplatesLoaded } from '../stores/formattingTemplateStore';
import { applyScriptFormat } from '../utils/applyScriptFormat';
import { isTitlePageRuleId, AV_BLOCK_RULE_ID } from '../stores/formattingTypes';
import { INDUSTRY_STANDARD_ID, ELEMENT_DESCRIPTIONS } from '../stores/formattingTypes';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';
import { selectionStartsNewPage } from '../editor/extensions';
import { pluginRegistry } from '../plugins/registry';
import AuthIndicator from './AuthIndicator';
import { useNavigate } from 'react-router-dom';
import { flushPendingSave, setLeaveGuard, leaveEditor as leaveEditorScreen } from '../services/pendingSave';
import { scriptApi } from '../services/scriptApi';
import { useSettingsStore } from '../stores/settingsStore';
import { clearEditorHistory } from '../editor/clearHistory';
import { clearSessionDoc } from '../utils/sessionDoc';
import { buildSaveContent as buildSaveContentShared } from '../utils/saveContent';
import { clearRecoverySnapshot } from '../services/recoveryService';
import {
  releaseOpenDocument,
  findWindowWithDocument,
  documentKey,
  focusWindow,
  type OpenElsewhere,
} from '../services/openDocuments';
import DocumentOpenElsewhereDialog from './DocumentOpenElsewhereDialog';

/**
 * Formats that can be *edited* in place, as against merely opened.
 *
 * Narrower than the import list on purpose: promising "Save writes back to
 * this file" for a format with no writer would strand the user's edits. Fade
 * In's .fadein is an OSF archive and WriTea Draft has no OSF writer, so it stays
 * an import-only format until one exists.
 */
/**
 * What Save can write back, and so what may be opened in place.
 *
 * .fadein and .osf joined the list once WriTea Draft gained a writer for them
 * (utils/osfExporter); before that, opening one would have promised a Save it
 * could not honour.
 */
const IN_PLACE_EDITABLE_EXTENSIONS = ['fdx', 'fountain', 'fadein', 'osf', 'txt'];

/** Of those, the ones that are containers rather than text. */
const IN_PLACE_BINARY_EXTENSIONS = ['fadein'];
import {
  backupsAvailable, backupsSupported, supportsRevealBackup, writeSnapshot, revealSnapshot,
} from '../services/backupService';
import { useBackupStatusStore, describeBackupError } from '../stores/backupStatusStore';
import RecoverBackupDialog from './RecoverBackupDialog';
import BackupFolderPrompt from './BackupFolderPrompt';
import UserManualDialog from './UserManualDialog';
import {
  openBinaryFile,
  openTextOrBinaryFile,
  openDocumentInPlace,
  saveDocumentInPlace,
  supportsOpenInPlace,
  type InPlaceDocument,
} from '../utils/fileOps';
import { isDesktopTauri, printRoute, supportsApplePencil, supportsMultipleWindows } from '../services/platform';
import { getCompatEntries } from '../services/compat';
import { reportSaveError } from '../stores/saveErrorStore';
import type { MenuSection as PluginMenuSection } from '../plugins/registry';
import {
  FaFile,
  FaPlus,
  FaTimes,
  FaPencilAlt,
  FaPalette,
  FaEye,
  FaWrench,
  FaQuestionCircle,
  FaFileImport,
  FaFolderOpen,
  FaArchive,
  FaSave,
  FaFileExport,
  FaFileExcel,
  FaFileCsv,
  FaFileCode,
  FaFilePdf,
  FaFileWord,
  FaCodeBranch,
  FaCog,
  FaPrint,
  FaUndo,
  FaRedo,
  FaCut,
  FaCopy,
  FaPaste,
  FaMousePointer,
  FaSearch,
  FaHashtag,
  FaSpellCheck,
  FaListOl,
  FaBold,
  FaItalic,
  FaUnderline,
  FaStrikethrough,
  FaSubscript,
  FaSuperscript,
  FaAlignLeft,
  FaAlignCenter,
  FaAlignRight,
  FaAlignJustify,
  FaColumns,
  FaFileAlt,
  FaCommentDots,
  FaHeading,
  FaImage,
  FaClock,
  FaCompass,
  FaTh,
  FaStream,
  FaStickyNote,
  FaUsers,
  FaTags,
  FaHighlighter,
  FaAdjust,
  FaToolbox,
  FaSignInAlt,
  FaFilm,
  FaBoxes,
  FaBars,
  FaInfoCircle,
  FaBook,
  FaStethoscope,
  FaSearchPlus,
  FaSearchMinus,
  FaUpload,
  FaHistory,
  FaExchangeAlt,
  FaCompressArrowsAlt,
  FaExpandArrowsAlt,
  FaEyeSlash,
  FaListUl,
  FaToggleOn,
  FaLock,
  FaFileSignature,
  FaFont,
  FaSun,
  FaMoon,
  FaRegFileAlt,
  FaStepForward,
  FaEraser,
  FaUnlock,
  FaSlidersH,
  FaBan,
} from 'react-icons/fa';
import { REVISION_COLORS, nextRevisionColor } from '../editor/revisionColors';
import RevisionSettingsDialog from './RevisionSettingsDialog';
import ScriptProfileDialog from './ScriptProfileDialog';
import { DEFAULT_SCRIPT_PROFILE } from '../utils/scriptProfile';
import { pagesLocked } from '../editor/extensions/LockedPages';
import { omitSceneTransaction, sceneOmittedAt } from '../editor/omitScene';

/** What Fade In carries beyond the text: Revision Mode's colour and marks,
 *  and how scenes are numbered. */
function osfExtras(s: ReturnType<typeof useEditorStore.getState>) {
  return {
    revisions: { color: s.revisionMode ? s.revisionColor : '', settings: s.revisionSettings },
    sceneNumbers: { visible: s.sceneNumbersVisible, locked: s.sceneNumbersLocked },
  };
}

interface MenuBarProps {
  editor: Editor | null;
  onCollaborate?: () => void;
  onJoinCollab?: () => void;
  isCollabActive?: boolean;
  isCollabGuest?: boolean;
  /**
   * Called with the payload that was just written, so the editor's own idea of
   * "what is on disk" keeps up. Without it a document saved from this menu
   * still looked unsaved to the crash-recovery loop, which then offered it back
   * on the next launch.
   */
  onDocumentSaved?: (savedJson: string) => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  children?: MenuItem[];
  icon?: React.ReactNode;
  /** Hover explanation, for items whose label does not say what they do. */
  title?: string;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const DiagRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <tr>
    <td style={{ padding: '4px 8px', color: 'var(--fd-text-secondary)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
      {label}
    </td>
    <td style={{
      padding: '4px 8px',
      color: 'var(--fd-text)',
      fontFamily: mono ? 'ui-monospace, Menlo, Consolas, monospace' : undefined,
      wordBreak: 'break-word',
    }}>
      {value}
    </td>
  </tr>
);

const MenuBar: React.FC<MenuBarProps> = ({
  editor,
  isCollabGuest,
  onDocumentSaved,
}) => {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Platform-aware modifier key symbol for shortcut labels
  const mod = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  // Written the way this platform writes it, from whatever the writer set.
  const elementMenuShortcut = useSettingsStore((s) => s.elementMenuShortcut);
  const printViaPdf = useSettingsStore((s) => s.printViaPdf);
  const {
    navigatorOpen,
    toggleNavigator,
    indexCardsOpen,
    toggleIndexCards,
    beatBoardOpen,
    toggleBeatBoard,
    scriptNotesOpen,
    toggleScriptNotes,
    characterProfilesOpen,
    toggleCharacterProfiles,
    tagsPanelOpen,
    toggleTagsPanel,
    locationDatabaseOpen,
    toggleLocationDatabase,
    notesVisible,
    setNotesVisible,
    tagsVisible,
    setTagsVisible,
    revisionMode,
    setRevisionMode,
    revisionColor,
    setRevisionColor,
    advanceRevisionColor,
    showRevisionColors,
    setShowRevisionColors,
    documentTitle,
    pageLayout,
    setSearchOpen,
    setGoToPageOpen,
    spellCheckEnabled,
    toggleSpellCheck,
    setSpellModalOpen,
    grammarCheckEnabled,
    toggleGrammarCheck,
    setGrammarModalOpen,
    setGrammarRulesPanelOpen,
    setPostSaveAction,
    setSaveAsOpen,
    appearance,
    setAppearance,
    toolbarMode,
    setToolbarMode,
    zoomLevel,
    setZoomLevel,
    navPanelWidth,
    trackChangesEnabled,
    setTrackChangesEnabled,
    setTrackChangesLabel,
    setCompareVersionOpen,
    sceneNumbersVisible,
    setSceneNumbersVisible,
    sceneNumbersLocked,
    setSceneNumbersLocked,
    pageLabels,
  } = useEditorStore();

  const {
    currentProject,
    currentScriptId,
    setCurrentProject,
    setCurrentScriptId,
    setScripts,
    setVersionHistoryOpen,
  } = useProjectStore();

  // Build a saveable content object: editor JSON + store metadata at top level.
  // This used to be a hand-maintained copy of ScreenplayEditor's version and had
  // drifted, omitting the spelling/grammar keys — so a manual Cmd+S silently
  // reset those settings on the next load. Both now share utils/saveContent.
  const buildSaveContent = useCallback(
    (): Record<string, unknown> | undefined => buildSaveContentShared(editor),
    [editor],
  );

  /**
   * Serialize the open document in the format its origin file uses.
   *
   * Bytes for the archive formats, text for the rest; the caller passes
   * whichever comes back straight to the platform's writer.
   *
   * Declared above handleSave because that hook lists it as a dependency —
   * a later `const` would be in its temporal dead zone at render time.
   */
  const serializeForOrigin = useCallback(
    async (format: string): Promise<string | Uint8Array> => {
      if (!editor) throw new Error('No document is open.');
      const s = useEditorStore.getState();
      // Fade In's archive is the one binary format; it stays here because
      // only a file opened in place is ever written in it.
      if (format === 'fadein') {
        return exportFadeIn(editor.getJSON(), { font: { family: s.fontFamily, size: String(s.fontSize) }, ...osfExtras(s) });
      }
      // Everything else goes through the same serializer as files linked to
      // library scripts (issue #135), so the two can never write a format
      // differently. It works from the saved payload, which carries the
      // notes, beats and profiles .odraft keeps and .fdx partly does.
      const content = buildSaveContent();
      if (!content) throw new Error('No document is open.');
      return serializeContentForFormat(format, content, s.documentTitle, {
        font: { family: s.fontFamily, size: s.fontSize },
        meta: { page_count: s.pageCount },
      });
    },
    [editor, buildSaveContent],
  );

  /**
   * Write the open document back over the file it was opened from.
   *
   * Shared by Save and the file auto-save. Returns whether the file now holds
   * the document. An auto-save that keeps failing — a network drive that has
   * gone away — reports it once, when it starts failing, rather than on every
   * tick; the status bar carries the error in between.
   */
  const saveInPlace = useCallback(async (origin: DocumentOrigin, auto: boolean): Promise<boolean> => {
    const { setSaveStatus, saveStatus: before } = useEditorStore.getState();
    // ProseMirror documents are immutable, so a different object afterwards
    // means the writer kept typing while the file was written — and those
    // edits are not in it. Edits made during 'saving' do not mark the document
    // unsaved on their own, so this is the only thing that would notice.
    const docBefore = editor?.state.doc;
    setSaveStatus('saving');
    try {
      await saveDocumentInPlace(origin.bookmark, await serializeForOrigin(origin.format));
      // The writer may have opened something else while the write was in
      // flight; the status now belongs to that document, not this one.
      if (useEditorStore.getState().documentOrigin?.bookmark !== origin.bookmark) return true;
      if (editor && !editor.isDestroyed && editor.state.doc !== docBefore) {
        setSaveStatus('unsaved');
        return true;
      }
      setSaveStatus('saved');
      // The file now holds this document, so the editor's library bookkeeping
      // and the recovery snapshot must both stop treating it as unsaved work.
      const savedPayload = buildSaveContent();
      if (savedPayload) onDocumentSaved?.(JSON.stringify(savedPayload));
      clearRecoverySnapshot();
      return true;
    } catch (err) {
      console.error(auto ? 'Auto-save in place failed:' : 'Save in place failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      // Left in the error state on purpose: the file did NOT receive this
      // text, and showing "saved" would be telling the writer their work is
      // safe somewhere it is not.
      setSaveStatus('error', msg);
      if (!auto || before !== 'error') {
        showToast(`Could not save to ${origin.name}: ${msg}`, 'error');
      }
      return false;
    }
  }, [editor, serializeForOrigin, buildSaveContent, onDocumentSaved]);

  // ── Save current editor content to backend ──
  const saveToFileAsRef = useRef<() => Promise<boolean>>(async () => false);

  const handleSave = useCallback(async () => {
    if (!editor) return;

    // A document opened in place belongs to the user's file, not the library —
    // Save means "update that file". Checked before the project branch so it
    // works for a Dropbox screenplay that was never added to a project, which
    // is the whole point of opening in place.
    const origin = useEditorStore.getState().documentOrigin;
    if (origin) {
      await saveInPlace(origin, false);
      return;
    }

    if (!currentProject || !currentScriptId) {
      // No project yet — prompt user for project & file name
      await saveToFileAsRef.current();
      return;
    }
    const { setSaveStatus } = useEditorStore.getState();
    setSaveStatus('saving');
    try {
      const content = buildSaveContent();
      await scriptApi.saveScript(currentProject.id, currentScriptId, { content });
      setSaveStatus('saved');
      // A script linked to a file on disk is safe in the library either way,
      // but the writer pressed Save expecting their file to have it too.
      const fileStatus = useLinkedFileStore.getState().byScript[currentScriptId];
      if (fileStatus?.state === 'pending' && fileStatus.error) {
        const name = fileStatus.path.split(/[/\\]/).pop() || fileStatus.path;
        showToast(`Saved in WriTea Draft, but not to ${name}: ${fileStatus.error}. WriTea Draft will keep trying.`, 'error');
      }
      // The user's real copy now holds this text, so there is nothing left to
      // recover. Done here as well as in the snapshot hook because an explicit
      // save goes through this path without touching the auto-save bookkeeping
      // the hook compares against.
      clearRecoverySnapshot();
    } catch (err) {
      console.error('Save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setSaveStatus('error', msg);
      // AuthGate / QuotaExceededDialog already surfaced handled errors (401,
      // 402, 403 unverified) — reportSaveError skips them.  Other failures
      // get the blocking modal so the user can't miss them.
      reportSaveError(err, 'manual-save');
    }
  }, [editor, currentProject, currentScriptId, buildSaveContent, setSaveAsOpen, saveInPlace]);

  /**
   * Leave the editor for another screen of the app.
   *
   * Router navigation, not `window.location`: a full page load tore the whole
   * app down and rebuilt it, and it reset the history stack, so the Projects
   * screen's back arrow had nothing to return to and fell back to reloading
   * the editor from scratch instead of returning to the script the user left
   * (issues #65, #66).
   *
   * The catch is that a router navigation fires neither `beforeunload` nor
   * Tauri's close handler, which are what used to flush unsaved text on the
   * way out, and the editor's auto-save tick is 30 seconds wide. So flush
   * first — awaited, which is more than the unload handler could promise in a
   * WebView. flushPendingSave is a no-op when there is nothing outstanding, or
   * no document with somewhere to save to.
   */
  const leaveEditor = useCallback(async (go: () => void) => {
    // Through the shared guard registered below, so the account menu leaves
    // the editor the same way this menu does.
    await leaveEditorScreen(go);
  }, []);

  const goToSettings = useCallback(
    () => { void leaveEditor(() => navigate('/settings')); },
    [leaveEditor, navigate],
  );

  /** Save As: always opens the destination/project/filename picker, even when
   *  the current document is already saved. Use this to fork a local script
   *  to cloud (or vice versa) or to write a copy under a different name. */
  const handleSaveAs = useCallback(() => {
    if (!editor) return;
    void saveToFileAsRef.current();
  }, [editor, setSaveAsOpen]);

  /**
   * Save to File As… (desktop, issue #135).
   *
   * For a library script: write it to a file the writer picks and keep it
   * linked, so every later save updates that file too. For a file opened from
   * disk or a document not in the library: write it there and carry on
   * editing that file, as Open File from Disk would.
   */
  const handleSaveToFileAs = useCallback(async (): Promise<boolean> => {
    if (!editor) return false;
    const s = useEditorStore.getState();
    try {
      const lf = await import('../services/linkedFiles');
      const { save } = await import('@tauri-apps/plugin-dialog');
      const origin = s.documentOrigin;
      const ps = useProjectStore.getState();
      if (!origin && currentProject && currentScriptId && ps.isCloudScript(currentProject.id, currentScriptId)) {
        showToast('A cloud script cannot be linked to a file on this computer. Use File ▸ Export to save a copy.', 'error');
        return false;
      }
      const library = !origin && currentProject && currentScriptId
        ? { projectId: currentProject.id, scriptId: currentScriptId }
        : null;

      let defaultDir: string | null = origin ? lf.dirnameOf(origin.bookmark) : null;
      if (!defaultDir && library) {
        const link = await lf.getLink(library.scriptId);
        defaultDir = link ? lf.dirnameOf(link.path) : lf.projectFolder(currentProject);
      }
      if (!defaultDir) {
        const { documentDir } = await import('@tauri-apps/api/path');
        defaultDir = await documentDir();
      }
      const preferred = 'fdx';

      const picked = await save({
        title: 'Save to File',
        defaultPath: lf.joinPath(defaultDir, linkedFileName(s.documentTitle || 'Untitled', preferred)),
        filters: [
          { name: 'Final Draft', extensions: ['fdx'] },
        ],
      });
      if (!picked) return false;
      let path = picked;
      const ext = 'fdx' as const;
      if (extensionOfPath(path).toLowerCase() !== 'fdx') path = `${path}.fdx`;
      const name = lf.basenameOf(path);

      // One file, one script: two scripts saving to one file would overwrite
      // each other on every save.
      const taken = await lf.findLinkByPath(path);
      if (taken && taken.scriptId !== library?.scriptId) {
        showToast(`${name} is already where another script is saved. Choose a different name.`, 'error');
        return false;
      }

      if (library) {
        const content = buildSaveContent();
        if (!content) throw new Error('No document is open.');
        s.setSaveStatus('saving');
        // The library first, so the file gets exactly what is on screen.
        await scriptApi.saveScript(library.projectId, library.scriptId, { content });
        const outcome = await lf.linkScriptToFile(library.projectId, library.scriptId, path);
        useLinkedFileStore.getState().setOpenScriptFile({ scriptId: library.scriptId, path });
        s.setSaveStatus('saved');
        onDocumentSaved?.(JSON.stringify(content));
        clearRecoverySnapshot();
        if (outcome === 'written') {
          showToast(`Saved to ${name}. From now on, saving this script updates that file too.`, 'success');
        } else {
          const err = useLinkedFileStore.getState().byScript[library.scriptId]?.error;
          showToast(`Linked to ${name}, but it could not be written yet${err ? `: ${err}` : ''}. WriTea Draft will keep trying.`, 'error');
        }
        return true;
      }

      s.setSaveStatus('saving');
      await saveDocumentInPlace(path, await serializeForOrigin(ext));
      // The document is that file now: Save writes back to it from here on.
      s.setDocumentOrigin({ bookmark: path, name, format: ext });
      // A draft still called "Untitled …" takes the file's name, as it would
      // if the file were opened; a title the writer chose is kept.
      const fileTitle = name.replace(/\.\w+$/, '');
      if (fileTitle && (!s.documentTitle.trim() || /^untitled\b/i.test(s.documentTitle.trim()))) {
        s.setDocumentTitle(fileTitle);
      }
      s.setSaveStatus('saved');
      const saved = buildSaveContent();
      if (saved) onDocumentSaved?.(JSON.stringify(saved));
      clearRecoverySnapshot();
      showToast(`Saved to ${name}. Save now writes to this file.`, 'success');
      return true;
    } catch (err) {
      console.error('Save to File As failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      s.setSaveStatus('error', msg);
      showToast(`Could not save to the file: ${msg}`, 'error');
      return false;
    }
  }, [editor, currentProject, currentScriptId, buildSaveContent, serializeForOrigin, onDocumentSaved]);
  saveToFileAsRef.current = handleSaveToFileAs;


  // ── Unsaved-changes confirmation before New / Import ──
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // ── Word import: best-effort warning shown before opening the file picker ──
  const [docxImportWarningOpen, setDocxImportWarningOpen] = useState(false);
  /** Pending "you are about to hide N rows' worth of work" confirmation, for
   *  the AV column toggles. Null when nothing is being asked. */
  const [avColumnWarning, setAvColumnWarning] = useState<{ which: 'cue' | 'image'; rows: number } | null>(null);

  /**
   * Set when a file in someone else's format has been opened in place, so the
   * writer is told what saving back to it can and cannot carry. In the store,
   * so a file handed over by the operating system raises the same notice.
   */
  /**
   * True when the open document came from a file the user picked, rather than
   * from the library. Save writes back to that file, so the File menu says so
   * — see the Save items below. Read reactively, not through `getState()`, so
   * the labels change the moment a file is opened or closed.
   */
  const hasFileOrigin = useEditorStore((s) => s.documentOrigin !== null);

  const foreignFormatNotice = useEditorStore((s) => s.foreignFormatNotice);
  const setForeignFormatNotice = useEditorStore((s) => s.setForeignFormatNotice);

  /**
   * Set when the file just picked is already open in another window: the
   * document is held here, unopened, until the writer says what to do with it.
   */
  const [inPlaceElsewhere, setInPlaceElsewhere] =
    useState<{ other: OpenElsewhere; document: InPlaceDocument } | null>(null);

  /**
   * Applies an opened-in-place document. Held in a ref because the callback
   * that uses it is declared first — the alternative is reordering two hundred
   * lines of hooks around a two-line dependency.
   */
  const applyInPlaceRef = useRef<(doc: InPlaceDocument) => void>(() => {});
  const applyInPlaceDocument = useCallback((doc: InPlaceDocument) => {
    applyInPlaceRef.current(doc);
  }, []);

  /** Returns true if the editor has unsaved changes worth prompting about.
   *  - If never saved to a project: true when editor has any meaningful text.
   *  - If saved to a project: true when auto-save hasn't caught up yet
   *    (saveStatus is 'unsaved', 'saving', or 'error'). The 30s auto-save
   *    interval leaves a window where edits exist only in memory; resetting
   *    the editor in that window would silently discard them. */
  const editorHasUnsavedChanges = useCallback((): boolean => {
    if (!editor) return false;
    // A document opened in place has somewhere to be saved just as much as a
    // project script does, and Save keeps its status up to date. Without this
    // it fell through to the never-saved branch below, where any content at
    // all counts as unsaved — so a file that had *just* been written back
    // still claimed to have unsaved changes, and offering to save it aimed at
    // the library instead of the writer's own file.
    if (useEditorStore.getState().documentOrigin) {
      const status = useEditorStore.getState().saveStatus;
      return status === 'unsaved' || status === 'saving' || status === 'error';
    }
    if (currentProject && currentScriptId) {
      const status = useEditorStore.getState().saveStatus;
      return status === 'unsaved' || status === 'saving' || status === 'error';
    }
    // Never-saved document — prompt only if there's real content
    const text = editor.state.doc.textContent.trim();
    return text.length > 0;
  }, [editor, currentProject, currentScriptId]);

  const confirmOrRun = useCallback((action: () => void) => {
    if (editorHasUnsavedChanges()) {
      setPendingAction(() => action);
      setDiscardConfirmOpen(true);
    } else {
      action();
    }
  }, [editorHasUnsavedChanges]);

  const handleDiscardConfirmSave = useCallback(async () => {
    setDiscardConfirmOpen(false);
    // An in-place document is saved by writing its own file, which is exactly
    // what handleSave does when an origin is set. Sending it to Save As would
    // offer to file the writer's Dropbox screenplay into the library instead.
    if (useEditorStore.getState().documentOrigin) {
      await handleSave();
      pendingAction?.();
      setPendingAction(null);
      return;
    }
    if (!currentProject || !currentScriptId) {
      // No project yet — open save-as dialog; the pending action will run
      // after save-as completes (via postSaveAction in the store).
      const next = pendingAction;
      setPendingAction(null);
      if (await saveToFileAsRef.current()) next?.();
      return;
    }
    // Existing project — save inline, then run pending action
    await handleSave();
    pendingAction?.();
    setPendingAction(null);
  }, [handleSave, pendingAction, currentProject, currentScriptId, setSaveAsOpen, setPostSaveAction]);

  const handleDiscardConfirmDiscard = useCallback(() => {
    setDiscardConfirmOpen(false);
    // The crash-recovery copy holds exactly the edits just thrown away. Left
    // behind — leaving the editor for another screen unmounts it before the
    // snapshot hook can notice — the next launch offers to "recover" them.
    clearRecoverySnapshot();
    pendingAction?.();
    setPendingAction(null);
  }, [pendingAction]);

  const handleDiscardConfirmCancel = useCallback(() => {
    setDiscardConfirmOpen(false);
    setPendingAction(null);
  }, []);

  // ── Leaving the editor for another screen ──
  // With library auto-save on, outstanding work is flushed and the writer goes.
  // With it off nothing may be written unasked (issue #135), and a library
  // script is reloaded from the database on the way back, so they are asked —
  // the same Save / Discard / Cancel as File → Open. Anything else open (a
  // file from disk, an unsaved draft) is held in memory across the move by the
  // editor's session stash, so it needs no question.
  useEffect(() => {
    return setLeaveGuard((go) => {
      const libraryScript =
        Boolean(currentProject && currentScriptId) && !useEditorStore.getState().documentOrigin;
      if (libraryScript && !autoSaveAppliesToOpenDocument(useSettingsStore.getState(), false) && editorHasUnsavedChanges()) {
        confirmOrRun(go);
        return;
      }
      void flushPendingSave().then(go);
    });
  }, [currentProject, currentScriptId, editorHasUnsavedChanges, confirmOrRun]);

  // ── Auto-save for a file opened from disk ──
  // Opt-in (Settings → Saving): it rewrites the writer's own file unasked, and
  // in another application's format that rewrite can drop what the format
  // cannot hold. Retries while the last attempt failed, so a network drive that
  // drops out and comes back catches up on its own.
  const autoSaveFiles = useSettingsStore((s) => s.autoSaveFiles);
  const autoSaveIntervalSeconds = useSettingsStore((s) => s.autoSaveIntervalSeconds);
  useEffect(() => {
    if (!hasFileOrigin || !autoSaveFiles || isCollabGuest) return;
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      const { documentOrigin, saveStatus } = useEditorStore.getState();
      if (!documentOrigin || (saveStatus !== 'unsaved' && saveStatus !== 'error')) return;
      running = true;
      saveInPlace(documentOrigin, true)
        .catch((err) => console.error('Auto-save in place threw:', err))
        .finally(() => { running = false; });
    }, autoSaveIntervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [hasFileOrigin, autoSaveFiles, autoSaveIntervalSeconds, isCollabGuest, saveInPlace]);

  // ── Page Setup ──
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);

  // ── Script-format preferences (multi-select) and per-script picker ──
  // `formatPrefsOpen` controls the multi-select preferences dialog. When `firstRun`
  // is true the dialog is non-cancellable and triggers `pendingFormatApply` after save.
  // `formatPickerOpen` is the single-select dialog shown when 2+ formats are enabled.
  const [formatPrefsOpen, setFormatPrefsOpen] = useState<{ firstRun: boolean; afterSave: 'apply-new-screenplay' | null } | null>(null);
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);

  // ── Per-attribute locking from active template ──
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const editorRule = editor ? getCurrentElementRule(editor, activeTemplate) : null;
  const locked = getLockedFormatting(editorRule, isEnforceMode);
  // Manual "start on a new page" flag for the element(s) under the cursor.
  const selectionOnNewPage = selectionStartsNewPage(editor);
  // AV row actions only mean something inside a two-column AV body. The gate is
  // the ROW, not the cell: clicking a storyboard frame selects the frame itself,
  // which has no cell in its ancestry, and gating on the cell greyed out every
  // AV control the moment the writer clicked the frame they wanted to fill.
  const inAvRow = editor ? isInAvRow(editor.state) : false;
  const avRowHint = inAvRow
    ? undefined
    : 'Put the cursor in an AV script\u2019s Video or Audio cell first';

  /**
   * The AV body and row under the cursor, for the column and storyboard menus.
   *
   * Read off the editor state rather than mirrored into React state: the menus
   * only open on demand, and a stale checkmark is worse than the cost of two
   * walks up the node tree.
   *
   * Memoised on the state itself. ProseMirror builds a new EditorState for
   * every transaction and reuses it across plain re-renders, so its identity is
   * exactly the right key — the walk runs when the document or the selection
   * moved, not on every hover — and the callbacks below that depend on the
   * result get a stable identity with it.
   */
  const editorState = editor?.state ?? null;
  const avContext = useMemo(() => {
    if (!editorState || !inAvRow) return null;
    try {
      const ctx = avRowContext(editorState);
      if (!ctx) return null;
      const { $from } = editorState.selection;
      const block = $from.node(ctx.blockDepth);
      const row = $from.node(ctx.rowDepth);
      const frame = row.childCount > 2 ? row.child(row.childCount - 1) : null;
      return {
        blockAttrs: block.attrs as Record<string, unknown>,
        frame: frame && frame.type.name === 'avImage' ? (frame.attrs as Record<string, unknown>) : null,
      };
    } catch {
      return null;
    }
  }, [editorState, inAvRow]);
  const avColumns = readColumnConfig(avContext?.blockAttrs);
  const avRepeatHeaders = (avContext?.blockAttrs as { repeatHeaders?: boolean } | undefined)?.repeatHeaders !== false;
  // Only the ratio is read off the frame now — the checkmark in the Frame
  // Aspect Ratio submenu. The picture itself is the command's business.
  const avFrameAspect = (avContext?.frame as { aspect?: string } | null)?.aspect || '16:9';

  /** Nudge one AV column's relative width; clamped by the command. */
  const nudgeAvWidth = useCallback((which: 'cue' | 'video' | 'audio' | 'image', delta: number) => {
    if (!editor) return;
    const current = readColumnConfig(avContext?.blockAttrs).widths[which];
    editor.chain().focus().setAvColumnWidth(which, current + delta).run();
  }, [editor, avContext]);

  /** Put one AV column back to the default width. */
  const resetAvWidth = useCallback((which: 'cue' | 'video' | 'audio' | 'image') => {
    if (!editor) return;
    editor.chain().focus().setAvColumnWidth(which, AV_DEFAULT_COLUMNS.widths[which]).run();
  }, [editor]);

  /**
   * Turn an AV column on or off, asking first when switching one off would take
   * work out of sight.
   *
   * Off is not a delete — durations stay on their rows, frames stay in theirs,
   * and turning the column back on brings them back exactly as they were. But
   * the flag also decides what `readAvBlock` writes, so a writer who has timed
   * their shots loses the gutter, the PDF column and the spreadsheet column in
   * one click, and from where they sit that is indistinguishable from losing
   * the timings. Turning a column ON never asks.
   */
  const toggleAvColumnChecked = useCallback((which: 'cue' | 'image') => {
    if (!editor) return;
    try {
      const block = avBlockAtSelection(editor.state);
      const turningOff = block ? readColumnConfig(block.attrs)[which] : false;
      const rows = block && turningOff ? avColumnDataCount(block, which) : 0;
      if (rows > 0) {
        setAvColumnWarning({ which, rows });
        return;
      }
    } catch (err) {
      // A count we could not take is not a reason to refuse the toggle; the
      // worst case is the writer is not asked about something reversible.
      console.warn('[av] could not check the column for data', err);
    }
    editor.chain().focus().toggleAvColumn(which).run();
  }, [editor]);

  /** The writer said yes to hiding the column. */
  const confirmAvColumnToggle = useCallback(() => {
    const pending = avColumnWarning;
    setAvColumnWarning(null);
    if (!editor || !pending) return;
    editor.chain().focus().toggleAvColumn(pending.which, false).run();
  }, [editor, avColumnWarning]);

  /** Flip whether this AV body repeats its header row on each printed page.
   *  Defaults to on, so only an explicit `false` counts as off. */
  const toggleAvRepeatHeaders = useCallback(() => {
    if (!editor) return;
    try {
      const ctx = avRowContext(editor.state);
      if (!ctx) return;
      const pos = editor.state.selection.$from.before(ctx.blockDepth);
      const block = editor.state.doc.nodeAt(pos);
      if (!block) return;
      const currentlyOn = (block.attrs as { repeatHeaders?: boolean }).repeatHeaders !== false;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...block.attrs, repeatHeaders: !currentlyOn }),
      );
    } catch (err) {
      console.warn('[av] could not toggle repeating headers', err);
    }
  }, [editor]);

  /**
   * Choose an image for the cursor's storyboard frame.
   *
   * Shared with the frame's own double-click handler (utils/avFrame), so both
   * routes upload to the project's asset store rather than embedding bytes in
   * the document, and both leave the frame's aspect ratio alone.
   */
  const pickAvFrame = useCallback(() => {
    void chooseAvFrameImage(editor);
  }, [editor]);

  // ── About / What's New ──
  const [recoverBackupOpen, setRecoverBackupOpen] = useState(false);
  // Backups asked for before a folder was chosen: ask for one here, then go on.
  const [backupFolderPrompt, setBackupFolderPrompt] = useState<'backup' | 'open' | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Asked of the platform rather than assumed: iPad can tile a second window
  // but iPhone cannot, and Android needs API 32+ (issue #63). Desktop answers
  // true immediately, so the item never flickers in there.
  const [canOpenWindow, setCanOpenWindow] = useState(isDesktopTauri());

  useEffect(() => {
    if (canOpenWindow) return;
    let cancelled = false;
    supportsMultipleWindows()
      .then((supported) => {
        if (!cancelled) setCanOpenWindow(supported);
      })
      .catch((err) => {
        // supportsMultipleWindows swallows its own failures; this is only here
        // so a rejected promise can never surface as an unhandled rejection.
        console.warn('[menu] multi-window check failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [canOpenWindow]);

  // ── Diagnostics (Help menu) ──
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // Compatibility detail in About starts collapsed (issue #94).
  const [compatOpen, setCompatOpen] = useState(false);
  const [diagnosticsReport, setDiagnosticsReport] = useState<import('../services/diagnostics').DiagnosticsReport | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const handleOpenDiagnostics = useCallback(async () => {
    const { collectDiagnostics } = await import('../services/diagnostics');
    setDiagnosticsReport(await collectDiagnostics());
    setDiagnosticsCopied(false);
    setDiagnosticsOpen(true);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!diagnosticsReport) return;
    try {
      const { formatReport } = await import('../services/diagnostics');
      await navigator.clipboard.writeText(formatReport(diagnosticsReport));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 2000);
    } catch (err) {
      showToast('Could not copy to clipboard', 'error');
    }
  }, [diagnosticsReport]);

  // ── Check in (git commit) ──
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [clearRevisionsOpen, setClearRevisionsOpen] = useState(false);
  const [revisionSettingsOpen, setRevisionSettingsOpen] = useState(false);
  const scriptProfileOpen = useEditorStore((s) => s.scriptProfileOpen);
  // Stable, so the dialog measures its runtime previews once per opening.
  const getEditorDoc = useCallback(() => (editor && !editor.isDestroyed ? editor.getJSON() : null), [editor]);
  const [checkinMessage, setCheckinMessage] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);
  const checkinInputRef = useRef<HTMLInputElement>(null);

  const handleCheckinOpen = useCallback(() => {
    if (!currentProject) {
      showToast('No project active. Save your file first.', 'error');
      return;
    }
    setCheckinMessage('');
    setCheckinOpen(true);
    setTimeout(() => checkinInputRef.current?.focus(), 100);
  }, [currentProject]);

  const handleCheckinSubmit = useCallback(async () => {
    if (!currentProject || !checkinMessage.trim()) return;
    setCheckinSaving(true);
    // Save first so the latest content is on disk
    if (editor && currentScriptId) {
      try {
        const content = buildSaveContent();
        await api.saveScript(currentProject.id, currentScriptId, { content });
      } catch (err) {
        console.error('Auto-save before checkin failed:', err);
        reportSaveError(err, 'manual-save');
        // Don't proceed with the check-in if we couldn't persist the latest
        // content — committing stale data would be worse than the failure.
        setCheckinSaving(false);
        return;
      }
    }
    try {
      const result = await api.checkin(currentProject.id, checkinMessage.trim());
      if (result.hash) {
        showToast(`Version saved: ${result.short_hash}`, 'success');
      } else {
        showToast(result.message || 'No changes to commit', 'success');
      }
    } catch (err) {
      showToast(`Check in failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setCheckinSaving(false);
      setCheckinOpen(false);
    }
  }, [editor, currentProject, currentScriptId, checkinMessage, buildSaveContent]);

  // ── Track Changes ──
  const clearTrackChanges = useCallback(() => {
    if (!trackChangesEnabled) return;
    setTrackChangesEnabled(false);
    setTrackChangesLabel('');
    if (editor) {
      const { tr } = editor.state;
      tr.setMeta(trackChangesPluginKey, { enabled: false, baseline: null });
      editor.view.dispatch(tr);
    }
  }, [editor, trackChangesEnabled, setTrackChangesEnabled, setTrackChangesLabel]);

  const handleTrackChangesToggle = useCallback(async () => {
    if (trackChangesEnabled) {
      clearTrackChanges();
      return;
    }

    if (!currentProject || !currentScriptId) {
      showToast('Save your script to a project first', 'error');
      return;
    }

    try {
      const versions = await api.getVersions(currentProject.id);
      if (versions.length === 0) {
        showToast('No versions yet — use File > Check In first', 'info');
        return;
      }

      const latest = versions[0];
      let scriptResp;
      try {
        scriptResp = await api.getScriptAtVersion(
          currentProject.id,
          latest.hash,
          currentScriptId,
        );
      } catch (innerErr) {
        // Script didn't exist at the last check-in (created after the last commit)
        const msg = innerErr instanceof Error ? innerErr.message : '';
        if (msg.includes('404')) {
          showToast('This script has no checked-in version yet — use File > Check In first', 'info');
        } else {
          showToast('Could not load the checked-in version. Try checking in first.', 'error');
        }
        return;
      }

      setTrackChangesEnabled(true);
      setTrackChangesLabel(latest.short_hash);

      if (editor) {
        const { tr } = editor.state;
        tr.setMeta(trackChangesPluginKey, {
          enabled: true,
          baseline: scriptResp.content,
        });
        editor.view.dispatch(tr);
      }
    } catch (err) {
      showToast('Could not load version history. Make sure the backend is running.', 'error');
    }
  }, [
    editor,
    currentProject,
    currentScriptId,
    trackChangesEnabled,
    setTrackChangesEnabled,
    setTrackChangesLabel,
  ]);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Capture the portal dropdown element via a callback ref on the portal
  useEffect(() => {
    if (activeMenu) {
      // The portal dropdown is the last .menu-dropdown in the body
      dropdownRef.current = document.body.querySelector(':scope > .menu-dropdown');
    } else {
      dropdownRef.current = null;
    }
  }, [activeMenu]);

  useEffect(() => {
    if (!activeMenu) return;
    // Only listen for outside clicks when a menu is open.
    // Delay registration so the opening click/touch doesn't immediately close it.
    let active = true;
    const timerId = setTimeout(() => {
      if (!active) return;
      const handleClose = (e: MouseEvent | TouchEvent) => {
        const target = e.target as Node;
        const inMenu = menuRef.current?.contains(target);
        const inDropdown = dropdownRef.current?.contains(target);
        if (!inMenu && !inDropdown) {
          setActiveMenu(null);
          setOpenSubmenu(null);
        }
      };
      document.addEventListener('mousedown', handleClose);
      document.addEventListener('touchstart', handleClose);
      cleanup = () => {
        document.removeEventListener('mousedown', handleClose);
        document.removeEventListener('touchstart', handleClose);
      };
    }, 10);
    let cleanup: (() => void) | null = null;
    return () => {
      active = false;
      clearTimeout(timerId);
      cleanup?.();
    };
  }, [activeMenu]);

  const setElement = (type: string) => {
    if (!editor) return;
    // "AV Columns" is not a paragraph type — it inserts a two-column body, and
    // `setNode('avBlock')` would be asked to put `avRow+` content into a line
    // of text. Every route to it goes through the same command.
    if (type === AV_BLOCK_RULE_ID) {
      editor.chain().focus().insertAvRow('below').run();
      return;
    }
    editor.chain().focus().setNode(type).run();
  };

  /**
   * The elements Format ▸ Element offers, for wherever the cursor is.
   *
   * Inside an AV cell that is the template's list for THAT column, resolved the
   * same way the toolbar and the element menu resolve it. Outside one, the four
   * AV paragraph types are dropped: they exist only inside a cell, and
   * `setNode('avShot')` on a line of Action asks the schema for a node the
   * document cannot hold there. They were listed here before `avCell` rules
   * existed — the AV template marks them enabled, and this list only filtered
   * out the title page.
   */
  const elementMenuRules = React.useMemo(() => {
    const inCell = editorState ? isInAvCell(editorState) : false;
    if (inCell) {
      const side = avCellSideAt(editorState!) || 'video';
      // The caret's own element, so it can always be converted back.
      const current = editorState!.selection.$from.parent;
      const currentId = current.type.name === 'customElement'
        ? String(current.attrs?.customTypeId || 'customElement')
        : current.type.name;
      return avCellElementRules(activeTemplate, side, currentId);
    }
    return scriptBodyElementRules(activeTemplate, isTitlePageRuleId);
  }, [editorState, activeTemplate]);

  /**
   * Cut, Copy and Paste run off ProseMirror's selection rather than the DOM's.
   * Opening this menu takes focus out of the editor, and on iOS that collapses
   * the DOM selection — which is why the old `document.execCommand` calls did
   * nothing there while the long-press callout worked fine.
   */
  const handleCut = useCallback(async () => {
    const result = await cutSelection(editor);
    if (!result.ok && result.error) showToast(result.error, 'error');
  }, [editor]);

  const handleCopy = useCallback(async () => {
    const result = await copySelection(editor);
    if (!result.ok && result.error) showToast(result.error, 'error');
  }, [editor]);

  const handlePaste = useCallback(async () => {
    const result = await pasteIntoEditor(editor);
    if (!result.ok && result.error) showToast(result.error, 'error');
  }, [editor]);

  const handlePasteAsFountain = useCallback(async () => {
    if (!editor) return;
    const result = await pasteAsFountain(editor);
    if (!result.ok && result.error) showToast(result.error, 'error');
  }, [editor]);

  /**
   * Open a screenplay from Files/Dropbox and keep editing *that* file, so Save
   * updates it rather than producing a fresh export the user has to file away
   * themselves (issue #62).
   */
  const handleOpenInPlace = useCallback(async () => {
    if (!editor) return;
    try {
      const outcome = await openDocumentInPlace(
        IN_PLACE_EDITABLE_EXTENSIONS,
        IN_PLACE_BINARY_EXTENSIONS,
      );
      if (outcome.status === 'cancelled') return;

      // Checked before the file is read, so an unsupported one is described as
      // what it is. Reading it first meant a .docx or a photo failed inside the
      // text decoder and surfaced as "could not open the file — it may have
      // been moved, renamed or deleted", which sends the writer looking for a
      // problem with their file rather than with the format.
      if (outcome.status === 'unsupported') {
        const ext = outcome.extension;
        showToast(
          ext
            ? `WriTea Draft cannot edit .${ext} files in place. Use File ▸ Import to bring a copy in.`
            : 'WriTea Draft cannot edit that kind of file. Use File ▸ Import to bring a copy in.',
          'error',
        );
        return;
      }

      const opened = outcome.document;

      // A file that is linked to a script in a project folder is that script.
      // Editing it here as well would leave two copies writing one file.
      if (isDesktopTauri()) {
        const lf = await import('../services/linkedFiles');
        const link = await lf.findLinkByPath(opened.bookmark);
        if (link) {
          showToast(`${opened.name} belongs to one of your projects — opened it there.`, 'info');
          navigate(`/project/${link.projectId}/edit/${link.scriptId}`);
          return;
        }
      }

      // Asked before the document is put on screen. The editor notices a
      // duplicate after the fact as well, but being shown a screenplay and
      // then asked whether you meant to open it reads as if opening it caused
      // the problem — see useOpenDocumentGuard.
      const other = await findWindowWithDocument(documentKey(null, null, opened.bookmark) ?? '');
      if (other) {
        setInPlaceElsewhere({ other, document: opened });
        return;
      }

      applyInPlaceDocument(opened);
    } catch (err) {
      console.error('Open in place failed:', err);
      showToast(`Could not open the file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, applyInPlaceDocument, navigate]);

  /** Put an opened-in-place document into the editor. */
  const applyInPlaceDocumentImpl = useCallback(async (opened: InPlaceDocument) => {
    if (!editor) return;
    try {
      const ext = opened.name.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';

      clearTrackChanges();
      const imported = await parseScreenplayImport(
        opened.name,
        opened.bytes ?? opened.text ?? '',
      );
      const store = useEditorStore.getState();

      editor.commands.setContent(imported.doc, true);
      clearEditorHistory(editor);

      const scriptTitle = imported.title || opened.name.replace(/\.\w+$/, '') || 'Untitled';
      store.setDocumentTitle(scriptTitle);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
      // Not setImportedSource: this is not a copy. Save writes back here.
      store.setImportedSource(null);
      store.setDocumentOrigin({ bookmark: opened.bookmark, name: opened.name, format: ext });
      useBackupStatusStore.getState().noteDocumentOpened();

      for (const w of imported.warnings) console.warn('[Open in place]', w);

      // Every format but WriTea Draft's own loses something on the way back out,
      // and the writer should hear that when they open the file rather than
      // discover it later in a file that no longer has their notes.
      if (ext === 'fdx') {
        showToast(`Editing ${opened.name} — Save writes back to this file.`, 'success');
      } else {
        setForeignFormatNotice({ name: opened.name, extension: ext });
      }
    } catch (err) {
      console.error('Opening the document failed:', err);
      showToast(`Could not open the file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  applyInPlaceRef.current = applyInPlaceDocumentImpl;

  const handleImport = useCallback(async () => {
    if (!editor) return;
    try {
      const result = await openTextOrBinaryFile(SCREENPLAY_IMPORT_FILTERS, BINARY_IMPORT_EXTENSIONS);
      if (!result) return;

      const { name } = result;

      // Clear previous document state before importing
      clearTrackChanges();

      const imported = await parseScreenplayImport(name, result.bytes ?? result.text ?? '');
      const store = useEditorStore.getState();

      editor.commands.setContent(imported.doc, true);
      clearEditorHistory(editor);

      // Open as unsaved document — user can save later via Cmd+S
      const scriptTitle = imported.title || name.replace(/\.\w+$/, '') || 'Untitled';
      store.setDocumentTitle(scriptTitle);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
      // Track that this is an imported document so Save As can warn the user
      // that the save goes to WriTea Draft's library, not back to the source file.
      store.setImportedSource({ name, format: imported.formatLabel });
      // Imported files have no library copy — snapshot immediately.
      useBackupStatusStore.getState().noteDocumentOpened();

      if (imported.warnings.length > 0) {
        showToast(`Imported with ${imported.warnings.length} note(s). See console for details.`, 'info');
        for (const w of imported.warnings) console.warn('[Import]', w);
      }
    } catch (err) {
      console.error('Import failed:', err);
      showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  /**
   * Import an AV spreadsheet as a new AV document.
   *
   * Column mapping is guessed from the header row, because a sheet from another
   * production will not use WriTea Draft's names — see utils/avImport. The guess is
   * reported in a toast so the writer can see what it decided rather than having
   * to compare the result against the source by eye.
   */
  const handleImportAvSheet = useCallback(async () => {
    if (!editor) return;
    try {
      const result = await openTextOrBinaryFile(
        [{ name: 'AV Document', extensions: ['yaml', 'yml', 'xlsx', 'csv'] }],
        ['xlsx'],
      );
      if (!result) return;

      const isYaml = /\.(ya?ml)$/i.test(result.name);
      const isXlsx = /\.xlsx$/i.test(result.name);

      let blocks: JSONContent[];
      let rowCount: number;
      let summary: string;

      if (isYaml) {
        // AvYamlError carries a message written for the writer — a file from a
        // newer WriTea Draft, or one that is not an AV document — so it is shown
        // as-is rather than wrapped in a generic failure.
        const { importAvYaml } = await import('../utils/avYaml');
        const parsed = importAvYaml(result.text ?? '');
        blocks = parsed.blocks;
        rowCount = parsed.rowCount;
        summary = `Imported ${rowCount} shot(s) from AV YAML`;
      } else {
        const { importAvCsv, importAvXlsx } = await import('../utils/avImport');
        const imported = isXlsx
          ? await importAvXlsx(result.bytes ?? new ArrayBuffer(0))
          : importAvCsv(result.text ?? '');
        // One block per body: a document exported with two AV sections comes
        // back as two, not as one with the second section's header sitting in
        // the middle of it as a shot.
        blocks = imported.blocks;
        rowCount = imported.rowCount;
        const mapped = imported.roles.filter(r => r !== 'ignore');
        const bodies = imported.blocks.length > 1 ? ` across ${imported.blocks.length} bodies` : '';
        summary = `Imported ${rowCount} shot(s)${bodies}; matched ${mapped.length} column(s): ${mapped.join(', ')}`;
      }

      if (rowCount === 0) {
        showToast('That file had no AV rows to import.', 'error');
        return;
      }

      clearTrackChanges();
      // Same reason the Word import does it: beats, notes, tags, character
      // profiles and scenes live outside the document, so replacing the
      // document alone leaves the previous script's panels standing beside the
      // imported shot list as though they belonged to it.
      resetStoresForImport();
      editor.commands.setContent({ type: 'doc', content: blocks }, true);
      clearEditorHistory(editor);

      const store = useEditorStore.getState();
      const scriptTitle = result.name.replace(/\.\w+$/, '') || 'Untitled';
      store.setDocumentTitle(scriptTitle);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
      store.setImportedSource({
        name: result.name,
        format: isYaml ? 'WriTea Draft AV YAML' : isXlsx ? 'AV Spreadsheet (.xlsx)' : 'AV Spreadsheet (.csv)',
      });
      useBackupStatusStore.getState().noteDocumentOpened();
      showToast(summary, 'info');
    } catch (err) {
      console.error('AV import failed:', err);
      showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  // Core Word import: open binary file → parse → apply.  The pre-import
  // warning dialog and the unsaved-changes guard wrap this.
  const handleImportDocxCore = useCallback(async () => {
    if (!editor) return;
    try {
      const result = await openBinaryFile([
        { name: 'Word Document', extensions: ['docx'] },
      ]);
      if (!result) return;

      const { name, content } = result;
      const parsed = await parseDocx(content);

      // Clear previous document state
      clearTrackChanges();
      resetStoresForImport();
      const store = useEditorStore.getState();

      editor.commands.setContent(parsed.doc, true);
      clearEditorHistory(editor);

      const scriptTitle = parsed.scriptTitle || name.replace(/\.\w+$/, '') || 'Untitled';
      store.setDocumentTitle(scriptTitle);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
      store.setImportedSource({ name, format: 'Microsoft Word (.docx)' });

      if (parsed.warnings.length > 0) {
        const summary = parsed.ambiguousCount > 0
          ? `Imported with ${parsed.ambiguousCount} paragraph(s) auto-classified as Action — review the script.`
          : `Imported with ${parsed.warnings.length} note(s). See console for details.`;
        showToast(summary, 'info');
        for (const w of parsed.warnings) console.warn('[Word Import]', w);
      } else {
        showToast('Word document imported.', 'info');
      }
    } catch (err) {
      console.error('Word import failed:', err);
      showToast(`Word import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  // Wraps handleImportDocxCore with the best-effort warning dialog.
  const handleImportDocx = useCallback(() => {
    setDocxImportWarningOpen(true);
  }, []);

  const handleConfirmDocxImport = useCallback(() => {
    setDocxImportWarningOpen(false);
    // Run through unsaved-changes guard, then through the core importer.
    confirmOrRun(() => { handleImportDocxCore(); });
  }, [confirmOrRun, handleImportDocxCore]);

  /** Resets all per-script session state for a fresh new-screenplay,
   *  but does NOT seed editor content — caller picks the format and content. */
  const resetForNewScreenplay = useCallback(() => {
    if (!editor) return;
    clearTrackChanges();
    clearEditorHistory(editor);
    // The document being replaced must not come back on the next route change:
    // a fresh screenplay has the same (null) project/script ids the stash of an
    // imported or never-saved document carries.
    clearSessionDoc();
    setCurrentProject(null);
    setCurrentScriptId(null);
    setScripts([]);
    const store = useEditorStore.getState();
    // Also drops documentOrigin, which is the point: without it, starting a new
    // screenplay while a file was open in place left Save still aimed at that
    // file — so the next ⌘S wrote a blank document over the writer's script.
    store.setImportedSource(null);
    store.setFdxRaw(null);
    store.setDocumentTitle('Untitled Screenplay');
    store.setBeats([]);
    store.setBeatColumns([]);
    store.setBeatArrangeMode('auto');
    store.setNotes([]);
    // General notes belong to the document too — leaving them behind carried
    // one script's notes into the next.
    store.setGeneralNotes([]);
    store.setTags([]);
    store.setTagCategories([]);
    store.setCharacterProfiles([]);
    store.setScenes([]);
    store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
    store.resetRevisionState();
    // A new screenplay starts at Standard pacing with no genres.
    store.setScriptProfile(DEFAULT_SCRIPT_PROFILE);
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  /**
   * File ▸ Close — put the document away and go back to an empty editor.
   *
   * Wrapped in confirmOrRun, so unsaved work is offered a save first rather
   * than being dropped. Closing is also a statement that the document is
   * finished with, so the crash-recovery snapshot goes with it: there is
   * nothing left to offer back on the next launch.
   */
  const handleCloseDocument = useCallback(() => {
    confirmOrRun(() => {
      if (!editor) return;
      resetForNewScreenplay();
      // A single empty element, not clearContent(): an empty document has no
      // block to put a cursor in, so the editor came back blank *and*
      // untypeable — no placeholder, no caret, nothing to click into.
      editor.commands.setContent({ type: 'doc', content: [{ type: 'sceneHeading', content: [] }] }, true);
      clearEditorHistory(editor);
      clearRecoverySnapshot();
      releaseOpenDocument();
      showToast('Document closed', 'success');
      window.setTimeout(() => { if (!editor.isDestroyed) editor.commands.focus('start'); }, 0);
    });
  }, [confirmOrRun, editor, resetForNewScreenplay]);

  /** Picker mode: 'reset' clears project context (top-level New Screenplay);
   *  'apply-only' just applies the template, leaving the current project intact
   *  (used by ProjectView so the new script stays in the current project). */
  const [formatPickerMode, setFormatPickerMode] = useState<'reset' | 'apply-only'>('reset');

  /** Apply the chosen format (sets active template + seeds starter content). */
  const finishNewScreenplayWithFormat = useCallback((templateId: string, mode: 'reset' | 'apply-only' = 'reset') => {
    if (mode === 'reset') resetForNewScreenplay();
    applyScriptFormat(editor, templateId);
    // Start with the cursor in the first line, ready to type.
    window.setTimeout(() => { if (editor && !editor.isDestroyed) editor.commands.focus('start'); }, 0);
  }, [editor, resetForNewScreenplay]);

  /** Run the format-selection flow. Mode 'reset' is the global New Screenplay
   *  action; 'apply-only' is invoked from in-project script creation, where the
   *  caller has already wired up project context. */
  const promptForNewScreenplayFormat = useCallback(async (mode: 'reset' | 'apply-only') => {
    if (!editor) return;
    setFormatPickerMode(mode);
    // The enabled ids are read back from localStorage the moment the app
    // starts, but a custom template among them lives in storage and arrives
    // over a promise. Wait for it, or a writer quick enough to beat the load
    // gets Industry Standard instead of their own format.
    await ensureTemplatesLoaded();
    const settings = useSettingsStore.getState();
    const enabled = settings.enabledScriptFormats;

    // First run — never asked the user. Show the multi-select prefs dialog.
    if (!settings.formatPreferencesInitialized) {
      setFormatPrefsOpen({ firstRun: true, afterSave: 'apply-new-screenplay' });
      return;
    }

    // No formats enabled (edge case — user deselected everything).
    if (enabled.length === 0) {
      setFormatPrefsOpen({ firstRun: false, afterSave: 'apply-new-screenplay' });
      return;
    }

    // Exactly one enabled — apply it directly, no prompt.
    if (enabled.length === 1) {
      finishNewScreenplayWithFormat(enabled[0], mode);
      return;
    }

    // 2+ enabled — show the quick single-select picker. Keeping several formats
    // enabled is the writer saying the next script could be any of them, so the
    // question still gets asked; the default is what the picker opens on.
    setFormatPickerOpen(true);
  }, [editor, finishNewScreenplayWithFormat]);

  const handleNewScreenplay = useCallback(() => {
    confirmOrRun(() => { void promptForNewScreenplayFormat('reset'); });
  }, [confirmOrRun, promptForNewScreenplayFormat]);

  // ProjectView sets pendingFormatPromptInProject=true before navigating into
  // the editor for a fresh in-project script. Consume it once on mount (or
  // when it becomes true) and prompt for a script format without touching the
  // project context ProjectView already wired up.
  const pendingFormatPromptInProject = useEditorStore((s) => s.pendingFormatPromptInProject);
  useEffect(() => {
    if (!pendingFormatPromptInProject || !editor) return;
    useEditorStore.getState().setPendingFormatPromptInProject(false);
    void promptForNewScreenplayFormat('apply-only');
  }, [pendingFormatPromptInProject, editor, promptForNewScreenplayFormat]);

  /**
   * The window's own close button.
   *
   * Closing a window is the same decision as File ▸ Close, so it asks the same
   * question — without this, the title-bar X and ⌘W threw away unsaved work
   * with no warning at all.
   *
   * Desktop only: iPadOS and Android give an app no say in the matter. What
   * covers those is the recovery snapshot, which is written on the way out.
   */
  useEffect(() => {
    if (!isDesktopTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const stop = await appWindow.onCloseRequested(async (event) => {
          if (!editorHasUnsavedChanges()) return;
          const origin = useEditorStore.getState().documentOrigin;
          const settings = useSettingsStore.getState();
          const autoSaveFile = settings.autoSaveFiles;
          // A library script with auto-save on is saved on the way out by the
          // editor's own close handler; asking as well only raced it.
          if (!origin && currentProject && currentScriptId && autoSaveAppliesToOpenDocument(settings, false)) return;
          // Held open until the work is saved or the writer has answered; the
          // dialog's Save and Discard both end in destroy(), and Cancel simply
          // leaves it open.
          event.preventDefault();
          // Auto-save covers closing too. If the file cannot be written, fall
          // through to the question rather than lose the edits.
          if (origin && autoSaveFile && await saveInPlace(origin, true)) {
            void appWindow.destroy();
            return;
          }
          confirmOrRun(() => {
            void appWindow.destroy();
          });
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch (err) {
        // Without the hook the window closes as it always did; losing the
        // prompt is not a reason to break the editor.
        console.warn('[window] could not watch for the close button:', err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [editorHasUnsavedChanges, confirmOrRun, currentProject, currentScriptId, saveInPlace]);

  const handleExportFDX = useCallback(async () => {
    if (!editor) return;
    try {
      const s = useEditorStore.getState();
      await downloadFDX(editor.getJSON(), documentTitle, s.characterProfiles, s.tagCategories, s.tags, s.beats, s.beatColumns, s.pageLayout,
        { family: s.fontFamily, size: s.fontSize },
        buildExportFootnotePlan(editor.getJSON(), s.pageLayout, s.notes, s.generalNotes),
        { mode: s.revisionMode, color: s.revisionColor, settings: s.revisionSettings },
          { sceneNumbersVisible: s.sceneNumbersVisible }, s.fdxRaw);
    } catch (err) {
      console.error('FDX export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  const handleExportFadeIn = useCallback(async () => {
    if (!editor) return;
    try {
      const s = useEditorStore.getState();
      const { downloadFadeIn } = await import('../utils/osfExporter');
      await downloadFadeIn(editor.getJSON(), documentTitle, {
        font: { family: s.fontFamily, size: String(s.fontSize) },
        ...osfExtras(s),
      });
    } catch (err) {
      console.error('Fade In export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  const handleExportFountain = useCallback(async () => {
    if (!editor) return;
    try {
      await downloadFountain(editor.getJSON(), documentTitle, {
        revisionSettings: useEditorStore.getState().revisionSettings,
        sceneNumbersVisible: useEditorStore.getState().sceneNumbersVisible,
      });
    } catch (err) {
      console.error('Fountain export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  /**
   * AV-specific exports.
   *
   * These only appear when the document actually contains an AV body. A
   * spreadsheet is the interchange format for AV work because the industry has
   * no structured shot-list standard — FDX, Fountain and OSF are built around
   * screenplay elements — while production tools exchange CSV and xlsx.
   */
  /** Whether the open document contains an AV body, which gates the AV-only
   *  export formats. Recomputed when the document changes rather than on every
   *  render — walking the doc is cheap but not free, and the menu re-renders
   *  on hover. */
  const [hasAv, setHasAv] = useState(false);
  useEffect(() => {
    if (!editor) { setHasAv(false); return; }
    // Walked straight off the ProseMirror doc, stopping at the first AV body.
    // It used to serialise the whole document with getJSON() and then read
    // every AV body out of it in full, twice per keystroke, to answer a yes/no
    // that only changes when a body is inserted or removed.
    const recompute = () => {
      try {
        let found = false;
        editor.state.doc.descendants((node) => {
          if (found) return false;
          if (node.type.name === 'avBlock') { found = true; return false; }
          // Inline content cannot hold a body, so there is no reason to enter it.
          return node.isBlock;
        });
        setHasAv(found);
      } catch (err) {
        console.warn('[av] could not check the document for AV bodies', err);
        setHasAv(false);
      }
    };
    recompute();
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) recompute();
    };
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor]);

  const handleExportAv = useCallback(async (kind: 'xlsx' | 'csv' | 'txt' | 'yaml') => {
    if (!editor) return;
    try {
      const json = editor.getJSON();
      if (kind === 'yaml') {
        const { downloadAvYaml } = await import('../utils/avYaml');
        await downloadAvYaml(json, documentTitle);
        return;
      }
      const mod = await import('../utils/avSpreadsheet');
      if (kind === 'xlsx') await mod.downloadAvXlsx(json, documentTitle);
      else if (kind === 'csv') await mod.downloadAvCsv(json, documentTitle);
      else await mod.downloadAvText(json, documentTitle);
    } catch (err) {
      console.error('AV export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  /** Everything the PDF exporter needs beyond the document itself. Shared, so
   *  what Print sends to the printer is the file Export would have written. */
  const pdfOptions = useCallback((json: JSONContent): PDFExportOptions => {
    const store = useEditorStore.getState();
    return {
      sceneNumbersVisible: store.sceneNumbersVisible,
      documentTitle: store.documentTitle,
      revisionColor: store.revisionMode ? store.revisionColor : '',
      documentFont: store.fontFamily,
      footnotes: buildExportFootnotePlan(json, pageLayout, store.notes, store.generalNotes),
      includeTitlePage: store.includeTitlePageInOutput,
      revisionSettings: store.revisionSettings,
      colorRevisedPages: store.revisionSettings.colorPages,
      pageLabels: store.pageLabels,
    };
  }, [pageLayout]);

  /** File → Export → PDF (Revised Pages Only): the pages that go out to cast
   *  and crew between full drafts. */
  const handleExportRevisedPDF = useCallback(async () => {
    if (!editor) return;
    try {
      const json = editor.getJSON();
      const warning = await exportPDF(json, `${documentTitle || 'Untitled'} - Revised Pages`, pageLayout, {
        ...pdfOptions(json),
        revisedPagesOnly: true,
      });
      if (warning) showToast(warning, 'error');
    } catch (err) {
      console.error('Revised-pages PDF export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout, pdfOptions]);

  /** Tools → Production → Lock Pages / Unlock Pages. */
  const handleToggleLockPages = useCallback(() => {
    if (!editor) return;
    try {
      if (pagesLocked(editor.state.doc)) {
        editor.chain().focus().unlockPages().run();
        showToast('Pages unlocked — page numbers flow freely again', 'info');
        return;
      }
      const start = resolveHeaderFooter(pageLayout).startingPageNumber;
      const ok = editor.chain().focus().lockPages((page) => String(printedPageNumber(page, start))).run();
      if (ok) showToast('Pages locked — new text spills onto A pages instead of renumbering', 'success');
      else showToast('Could not lock pages: the script has not been paginated yet', 'error');
    } catch (err) {
      console.error('[lockedPages] toggle failed', err);
      showToast(`Could not change page locking: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, pageLayout]);

  /** Tools → Production → Omit Scene: the scene at the cursor becomes an
   *  OMITTED heading that keeps its locked number. */
  const handleOmitScene = useCallback(() => {
    if (!editor) return;
    try {
      const pos = editor.state.selection.from;
      if (sceneOmittedAt(editor.state, pos)) {
        showToast('This scene is already omitted', 'info');
        return;
      }
      const tr = omitSceneTransaction(editor.state, pos);
      if (!tr) {
        showToast('Put the cursor in the scene you want to omit', 'info');
        return;
      }
      editor.view.dispatch(tr);
      editor.commands.focus();
      showToast('Scene omitted — Edit → Undo brings it back', 'success');
    } catch (err) {
      console.error('[omitScene] failed', err);
      showToast(`Could not omit the scene: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor]);

  const handleExportPDF = useCallback(async () => {
    if (!editor) return;
    try {
      const json = editor.getJSON();
      // A font that would not load leaves the script it was for blank on the
      // page — the writer has to hear that now, not from whoever they send it
      // to. See RenderedPDF.warning.
      const warning = await exportPDF(json, documentTitle, pageLayout, pdfOptions(json));
      if (warning) showToast(warning, 'error');
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout, pdfOptions]);

  /**
   * File → Print (and ⌘P).
   *
   * Where the web view has a print dialog this is that dialog, rendering the
   * paginated editor through the @media print rules exactly as it appears.
   * Neither mobile platform has one — see printRoute() for why — so both send
   * the PDF instead: iOS to the share sheet that carries AirPrint (issue #97),
   * Android to PrintManager, which gives the real system print dialog with
   * printer, copies and Save as PDF. Either way it is the file File → Export →
   * PDF would have written, so the printed script matches the exported one.
   */
  const handlePrint = useCallback(async () => {
    const route = printRoute();

    // Where there is a print dialog, the writer chooses what goes into it: the
    // PDF the exporter lays out, or the page as the web view paginates it.
    // Everywhere else there is no choice to make — see printRoute().
    if (route === 'dialog' && printViaPdf && editor) {
      try {
        showToast('Preparing your script for printing…');
        const json = editor.getJSON();
        const { renderPDF } = await import('../utils/pdfExporter');
        const { printPDFBytes } = await import('../utils/printPdf');
        const { bytes, filename, warning } = await renderPDF(json, documentTitle, pageLayout, pdfOptions(json));
        // The desktop web view cannot print a frame, so there the file is
        // opened in whatever the machine uses for PDFs and printed from there.
        const outcome = await printPDFBytes(bytes, filename, isDesktopTauri());
        if (warning) showToast(warning, 'error');
        else if (outcome === 'opened-externally') {
          showToast('Opened your script as a PDF — print it from there.');
        }
      } catch (err) {
        console.error('[print] could not print the PDF:', err);
        // The reason is in the message, not just the console: there is no
        // console to open in a packaged desktop build, and "it did not work"
        // on its own is what made the DOM print path so slow to diagnose.
        const reason = err instanceof Error ? err.message : String(err);
        showToast(`Could not print the PDF: ${reason}. Turn off "Print the PDF" in Settings → Printing to use the print dialog instead.`);
      }
      return;
    }

    if (route === 'dialog') {
      // In a browser this opens the dialog and returns nothing. Inside a Tauri
      // web view `window.print` is a shim over `plugin:webview|print`, so it
      // returns a promise — and one that rejects if the command is not allowed
      // by the ACL, which is how Print came to be a menu item that did nothing
      // at all on the desktop app. Awaited, so a refusal is something the
      // writer is told about rather than a menu item that silently does
      // nothing.
      // Let any open menu close first. Print is reached from the File menu,
      // and `handleItemClick` runs the action before it clears the menu, so
      // the dropdown was still mounted when the dialog took its snapshot —
      // and being portalled to the body it is outside everything the print
      // stylesheet hides. What came out was a picture of the File menu.
      // Two frames: one for React to re-render without it, one for the
      // browser to lay the page out again before it is captured.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      try {
        await (window.print() as unknown as void | Promise<void>);
      } catch (err) {
        console.error('[print] the web view refused to print:', err);
        showToast('Could not open the print dialog. Export to PDF and print that instead.');
      }
      return;
    }
    if (!editor) return;
    try {
      // Laying out a feature-length script takes a moment, and nothing appears
      // until it is done — without this the tap looks like it was ignored.
      showToast(route === 'ios-share-sheet'
        ? 'Preparing your script — choose Print in the share sheet.'
        : 'Preparing your script for printing…');

      const json = editor.getJSON();
      if (route === 'ios-share-sheet') {
        const warning = await exportPDF(json, documentTitle, pageLayout, pdfOptions(json));
        if (warning) showToast(warning, 'error');
        return;
      }
      const { bytes, filename, warning } = await renderPDF(json, documentTitle, pageLayout, pdfOptions(json));
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('android_print_pdf', { filename, contents: Array.from(bytes) });
      if (warning) showToast(warning, 'error');
    } catch (err) {
      console.error('Print failed:', err);
      showToast(`Print failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout, pdfOptions, printViaPdf]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F7' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) setGrammarModalOpen(true);
        else setSpellModalOpen(true);
        return;
      }
      const m = e.metaKey || e.ctrlKey;
      if (!m) return;
      switch (e.key) {
        case 'n':
          e.preventDefault();
          if (!isCollabGuest) handleNewScreenplay();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          if (!isCollabGuest) (e.shiftKey ? handleSaveAs() : handleSave());
          break;
        case 'w':
          e.preventDefault();
          if (!isCollabGuest) handleCloseDocument();
          break;
        case 'o':
          e.preventDefault();
          if (!isCollabGuest && supportsOpenInPlace()) confirmOrRun(handleOpenInPlace);
          break;
        case 'p':
          e.preventDefault();
          void handlePrint();
          break;
        case 'f':
          e.preventDefault();
          setSearchOpen(true);
          break;
        case 'g':
          e.preventDefault();
          setGoToPageOpen(true);
          break;
        case '=': // Cmd+= is Cmd++ on most keyboards
        case '+':
          e.preventDefault();
          setZoomLevel(Math.min(300, useEditorStore.getState().zoomLevel + 10));
          break;
        case '-':
          e.preventDefault();
          setZoomLevel(Math.max(50, useEditorStore.getState().zoomLevel - 10));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, handleSaveAs, handleNewScreenplay, handleCloseDocument, handlePrint, confirmOrRun, handleOpenInPlace, isCollabGuest, setSearchOpen, setGoToPageOpen, setZoomLevel, setSpellModalOpen, setGrammarModalOpen]);

  const handleExportDocx = useCallback(async () => {
    if (!editor) return;
    try {
      const store = useEditorStore.getState();
      await downloadDocx(editor.getJSON(), documentTitle, pageLayout, {
        footnotes: buildExportFootnotePlan(editor.getJSON(), pageLayout, store.notes, store.generalNotes),
        documentTitle: store.documentTitle,
        revisionSettings: store.revisionSettings,
        revisionColor: store.revisionMode ? store.revisionColor : '',
        documentFont: store.fontFamily,
        // So `{pages}` matches what the editor and the PDF report, rather than
        // Word's NUMPAGES, which counts the title page.
        scriptPageCount: store.pageCount,
        includeTitlePage: store.includeTitlePageInOutput,
      });
    } catch (err) {
      console.error('Word export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout]);

  // ── Backups ────────────────────────────────────────────────────────────
  // "Back Up Now" writes a snapshot into the configured folder immediately,
  // with no dialog. That is what makes it different from File → Export →
  // .odraft: Export is "give me a file to send somewhere", Back Up Now is "pin
  // this moment in my safety net". Same bytes, different lifecycle — manual
  // snapshots are never pruned by the retention limit.
  const backUpNow = useCallback(async () => {
    const content = buildSaveContent();
    if (!content) return;
    try {
      const store = useEditorStore.getState();
      const result = await writeSnapshot({
        content,
        title: store.documentTitle || 'Untitled',
        projectId: currentProject?.id ?? null,
        scriptId: currentScriptId ?? null,
        projectTitle: currentProject?.name,
        kind: 'manual',
      });
      // A successful manual backup also clears a paused scheduler — the user
      // has just demonstrated the folder works.
      useBackupStatusStore.getState().resume();
      showToast(`Backed up to ${result.filename}`, 'success');
    } catch (err) {
      const reason = describeBackupError(err instanceof Error ? err.message : String(err));
      showToast(`Backup failed — ${reason}`, 'error');
    }
  }, [buildSaveContent, currentProject, currentScriptId]);

  const handleBackupNow = useCallback(() => {
    if (!backupsAvailable()) {
      setBackupFolderPrompt('backup');
      return;
    }
    void backUpNow();
  }, [backUpNow]);

  const openBackupFolder = useCallback(async () => {
    const folder = useSettingsStore.getState().backupFolder;
    if (!folder) return;
    try {
      // The Documents default is only created by the first backup; make it
      // now so opening it straight after choosing it works.
      if (isDesktopTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('ensure_dir', { path: folder });
      }
      await revealSnapshot(folder);
    } catch (err) {
      console.error('[backup] could not open the backup folder:', err);
      showToast(`Could not open the backup folder: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, []);

  const handleOpenBackupFolder = useCallback(() => {
    if (!useSettingsStore.getState().backupFolder) {
      setBackupFolderPrompt('open');
      return;
    }
    void openBackupFolder();
  }, [openBackupFolder]);

  const handleMenuClick = (label: string) => {
    setActiveMenu((prev) => (prev === label ? null : label));
    setOpenSubmenu(null);
  };

  /**
   * Keep the writer's selection where it is while they reach for a menu.
   *
   * Pressing a menu moves focus out of the editor by default. On iPadOS that
   * costs the selection twice over: the highlight stops being painted, and —
   * the part this fixes — WebKit collapses the DOM selection on the way out,
   * ProseMirror's observer syncs the collapse into its own state, and the
   * caret comes back somewhere other than where the writer left it. A menu
   * that does not take focus leaves the selection exactly as it was.
   *
   * Same treatment as ElementPicker and CharacterAutocomplete: mousedown
   * rather than pointerdown, because preventing the pointer event suppresses
   * the click that follows it and the menu would stop responding at all.
   * Nothing inside a menu wants focus of its own.
   *
   * It does not bring the highlight back — an unfocused view paints none
   * regardless, which is what SelectionHandles' bands are for.
   */
  const keepEditorSelection = (e: React.MouseEvent) => e.preventDefault();

  const handleItemClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.disabled && item.action) {
      item.action();
    }
    setActiveMenu(null);
    setOpenSubmenu(null);
  };

  /**
   * Which submenu is open, as a path of labels rather than a single one.
   *
   * Submenus nest more than one deep (Format ▸ AV Script ▸ Columns ▸ Column
   * Width ▸ Video), so "the open submenu" is a trail, not a label: opening the
   * innermost one has to leave every ancestor open behind it. The separator is
   * a unit separator so no menu label can ever collide with it.
   */
  const SUBMENU_SEP = '\u241F';
  const submenuPath = (parentPath: string, label: string) =>
    parentPath ? `${parentPath}${SUBMENU_SEP}${label}` : label;
  /** True when `path`'s submenu is on the open trail — itself or an ancestor
   *  of whatever is open. */
  const isSubmenuOpen = (path: string) =>
    openSubmenu === path || (openSubmenu != null && openSubmenu.startsWith(path + SUBMENU_SEP));

  // Mouse: hover switches submenu (desktop) — no pointerleave to avoid layout shift
  const handleSubmenuPointerEnter = (path: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(path);
  };
  /** Hovering a plain row closes anything open *below* its own level, and
   *  leaves its ancestors alone — at depth 0 that is the old "close all". */
  const handleItemPointerEnter = (parentPath: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(parentPath || null);
  };
  // Touch: tap toggles submenu (mobile) — closing falls back to the parent
  // level so a tap on an inner submenu does not dismiss the whole trail.
  const handleSubmenuTouchEnd = (parentPath: string, path: string, e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenSubmenu((prev) => (prev === path || (prev != null && prev.startsWith(path + SUBMENU_SEP))
      ? (parentPath || null)
      : path));
  };

  /**
   * Place an open submenu, pinned to the viewport rather than to its parent.
   *
   * Fixed, not absolute, because the dropdown itself scrolls when it is taller
   * than the window (see `dropdownPos.maxHeight`): an absolutely positioned
   * flyout sitting outside its scroll container's padding box gets clipped
   * away entirely. Fixed coordinates leave the scroll container behind, which
   * also lets a deep submenu open past the bottom of a short window.
   *
   * Measured after clearing the previous placement, so a submenu that fits
   * only *because* it was flipped last render does not read as fitting and
   * flip back on the render after — easy to hit three levels deep, where every
   * level shifts another 240px right.
   *
   * Below the mobile breakpoint submenus render inline (`position: static`),
   * so there is nothing to place and inline coordinates would break the
   * stacked layout.
   */
  const positionSubmenu = (el: HTMLElement) => {
    const row = el.parentElement;
    if (!row) return;
    if (window.matchMedia('(max-width: 600px)').matches) {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.maxHeight = '';
      return;
    }
    el.style.position = 'fixed';
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.maxHeight = `${Math.max(120, window.innerHeight - 16)}px`;
    const anchor = row.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // Out to the right of the parent row, or back to its left when that would
    // leave the window.
    let left = anchor.right;
    if (left + box.width > window.innerWidth - 8) left = anchor.left - box.width;
    // Top-aligned with the row, lifted just enough to stay on screen.
    let top = anchor.top - 4;
    if (top + box.height > window.innerHeight - 8) top = window.innerHeight - 8 - box.height;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  };

  /**
   * One dropdown row, at any depth.
   *
   * Recursive because submenus nest: the old renderer drew exactly two levels,
   * so an item with children *inside* a submenu (Column Width, Frame Aspect
   * Ratio) rendered as a row with no arrow and no action — a dead end.
   */
  const renderMenuNode = (item: MenuItem, parentPath: string, index: number): React.ReactNode => {
    if (item.separator) {
      return (
        <div
          key={`sep-${index}`}
          className="menu-separator"
          onPointerEnter={(e) => handleItemPointerEnter(parentPath, e)}
        />
      );
    }
    if (item.children && item.children.length > 0) {
      const path = submenuPath(parentPath, item.label);
      const open = isSubmenuOpen(path);
      return (
        // Never marked `disabled` here: the class kills pointer events, and a
        // parent that cannot be opened hides its children instead of
        // explaining them. Leaves carry the disabled state and the hint.
        <div
          key={path}
          className={`menu-dropdown-item has-children ${open ? 'submenu-open' : ''}`}
          title={item.title}
          onPointerEnter={(e) => handleSubmenuPointerEnter(path, e)}
          onTouchEnd={(e) => handleSubmenuTouchEnd(parentPath, path, e)}
          onClick={(e) => {
            e.stopPropagation();
            setOpenSubmenu((prev) => (prev === path || (prev != null && prev.startsWith(path + SUBMENU_SEP))
              ? (parentPath || null)
              : path));
          }}
        >
          {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
          <span>{item.label}</span>
          <span className="menu-submenu-arrow">{open ? '\u25BE' : '\u25B8'}</span>
          <div
            className={`menu-submenu ${open ? 'submenu-visible' : ''}`}
            ref={(el) => { if (el && open) positionSubmenu(el); }}
          >
            {item.children.map((child, j) => renderMenuNode(child, path, j))}
          </div>
        </div>
      );
    }
    return (
      <div
        key={submenuPath(parentPath, item.label)}
        className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
        title={item.title}
        onPointerEnter={(e) => handleItemPointerEnter(parentPath, e)}
        onTouchEnd={(e) => e.stopPropagation()}
        onClick={(e) => handleItemClick(item, e)}
      >
        {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
        <span>{item.label}</span>
        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
      </div>
    );
  };

  const menus: MenuSection[] = [
    {
      label: 'File',
      items: [
        {
          icon: <FaPlus />,
          // "Script", not "Screenplay": this opens the format picker, where the
          // choice includes Stage Play, Radio Play, AV Script and two TV
          // formats. Only one of the six is a screenplay. "Script" is already
          // the app's word for the general thing — Script Notes, Script
          // Statistics, Script Format Preferences.
          label: 'New Script',
          shortcut: `${mod}N`,
          disabled: isCollabGuest,
          action: handleNewScreenplay,
        },
        ...(canOpenWindow ? [{
          icon: <FaFile />,
          label: 'New Window',
          action: async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('open_new_window');
            } catch (err) {
              showToast(`Failed to open new window: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
          },
        }] : []),
        { separator: true, label: '' },
        {
          icon: <FaFileImport />, label: 'Import',
          children: [
            { icon: <FaFileCode />, label: 'Final Draft / Fountain / Fade In / WriTea Draft…', action: () => confirmOrRun(handleImport), disabled: isCollabGuest },
            { icon: <FaFileWord />, label: 'Microsoft Word (.docx)…', action: handleImportDocx, disabled: isCollabGuest },
            { separator: true, label: '' },
            { icon: <FaFileExcel />, label: 'AV Document (.yaml / .xlsx / .csv)…', action: () => confirmOrRun(handleImportAvSheet), disabled: isCollabGuest },
          ],
        },
        // Mobile only: edit a screenplay where it lives — Files/iCloud/Dropbox
        // on iOS, the Storage Access Framework on Android — instead of
        // importing a copy and exporting it back afterwards.
        ...(supportsOpenInPlace() ? [{
          icon: <FaFolderOpen />,
          // "Files" is the app on iOS and Android; on desktop the same action
          // is just opening a file from disk.
          label: isDesktopTauri() ? 'Open File from Disk…' : 'Open from Files…',
          action: () => confirmOrRun(handleOpenInPlace),
          disabled: isCollabGuest,
        }] : []),
        {
          // "Close Script", not "Close": the menu bar lives inside the window on
          // touch platforms, with no window chrome around it to make plain
          // "Close" mean the document rather than the app (issue #78). Naming
          // the script removes that reading entirely. Named the same way on
          // every platform — one label set is easier to document and support
          // than one that changes per device.
          icon: <FaTimes />,
          label: 'Close Script',
          action: handleCloseDocument,
          disabled: isCollabGuest,
        },
        // Both Save items name their destination when the two differ. A
        // document opened in place has an origin file, so ⌘S overwrites it while
        // Save As still files a copy in the library and never touches it — the
        // one moment where saying where each one goes actually matters. With no
        // origin both go to the library, so the qualifier would be noise.
        {
          icon: <FaSave />,
          label: 'Save',
          shortcut: `${mod}S`,
          action: handleSave,
          disabled: isCollabGuest,
        },
        {
          icon: <FaSave />,
          label: 'Save As…',
          shortcut: `⇧${mod}S`,
          action: handleSaveAs,
          disabled: isCollabGuest,
        },
        { separator: true, label: '' },
        {
          icon: <FaFileExport />, label: 'Export',
          children: [
            { icon: <FaFileCode />, label: 'Final Draft (.fdx)', action: handleExportFDX, disabled: isCollabGuest },
            { icon: <FaFileAlt />, label: 'Fountain (.fountain)', action: handleExportFountain, disabled: isCollabGuest },
            { icon: <FaFileCode />, label: 'Fade In (.fadein)', action: handleExportFadeIn, disabled: isCollabGuest },
            { icon: <FaFilePdf />, label: 'PDF', action: handleExportPDF },
            {
              icon: <FaFilePdf />, label: 'PDF (Revised Pages Only)', action: handleExportRevisedPDF,
              title: 'Only the pages that carry a revision mark',
            },
            { icon: <FaFileWord />, label: 'Microsoft Word (.docx)', action: handleExportDocx },
            // AV formats are offered only for documents that have an AV body —
            // a spreadsheet of a screenplay would be meaningless.
            ...(hasAv
              ? [
                  { separator: true, label: '' },
                  { icon: <FaFileCode />, label: 'AV YAML (.yaml)', action: () => handleExportAv('yaml') },
                  { icon: <FaFileExcel />, label: 'AV Spreadsheet (.xlsx)', action: () => handleExportAv('xlsx') },
                  { icon: <FaFileCsv />, label: 'AV Spreadsheet (.csv)', action: () => handleExportAv('csv') },
                  { icon: <FaFileAlt />, label: 'AV Plain Text (.txt)', action: () => handleExportAv('txt') },
                ]
              : []),
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaCodeBranch />, label: 'Versions',
          disabled: isCollabGuest,
          children: [
            { icon: <FaUpload />, label: 'Check In…', action: handleCheckinOpen, disabled: isCollabGuest },
            { icon: <FaHistory />, label: 'Version History', action: () => setVersionHistoryOpen(true), disabled: isCollabGuest },
            { separator: true, label: '' },
            {
              icon: <FaExchangeAlt />,
              label: trackChangesEnabled
                ? '\u2713 Track Changes'
                : 'Track Changes Since Last Check-In',
              action: handleTrackChangesToggle,
            },
            { icon: <FaFileSignature />, label: 'Compare with Version\u2026', action: () => setCompareVersionOpen(true) },
          ],
        },
        // App builds only: a browser tab has nothing that can hold on to a
        // folder across a reload. Omitted rather than disabled — a permanently
        // greyed submenu just invites bug reports.
        ...(backupsSupported() ? [
          { separator: true, label: '' },
          {
            icon: <FaArchive />, label: 'Backups',
            disabled: isCollabGuest,
            children: [
              { icon: <FaArchive />, label: 'Back Up Now', action: handleBackupNow, disabled: isCollabGuest },
              { icon: <FaHistory />, label: 'Recover Backup\u2026', action: () => setRecoverBackupOpen(true) },
              { separator: true, label: '' },
              // No mobile equivalent: neither platform lets an app open the
              // Files browser at a particular folder.
              ...(supportsRevealBackup() ? [
                { icon: <FaFolderOpen />, label: 'Open Backup Folder', action: handleOpenBackupFolder },
              ] : []),
              { icon: <FaCog />, label: 'Backup Settings\u2026', action: goToSettings },
            ],
          },
        ] : []),
        { separator: true, label: '' },
        { icon: <FaCog />, label: 'Page Setup…', action: () => setPageSetupOpen(true) },
        // "Include Title Page" used to sit here. It moved to the Title Page
        // dialog (Format ▸ Title Page): a bare entry in a long File menu is not
        // where anyone looks for it — the writer who wants the title page kept
        // out of a PDF is the writer already looking at their title page.
        { icon: <FaPrint />, label: 'Print…', shortcut: `${mod}P`, action: () => { void handlePrint(); } },
      ],
    },
    {
      label: 'Edit',
      items: [
        { icon: <FaUndo />, label: 'Undo', shortcut: `${mod}Z`, action: () => { try { editor?.chain().focus().undo().run(); } catch {} } },
        { icon: <FaRedo />, label: 'Redo', shortcut: `⇧${mod}Z`, action: () => { try { editor?.chain().focus().redo().run(); } catch {} } },
        { separator: true, label: '' },
        { icon: <FaCut />, label: 'Cut', shortcut: `${mod}X`, action: handleCut, disabled: !editor },
        { icon: <FaCopy />, label: 'Copy', shortcut: `${mod}C`, action: handleCopy, disabled: !editor },
        { icon: <FaPaste />, label: 'Paste', shortcut: `${mod}V`, action: handlePaste, disabled: !editor },
        { icon: <FaPaste />, label: 'Paste as Fountain', shortcut: `⇧${mod}V`, action: handlePasteAsFountain, disabled: !editor },
        { icon: <FaMousePointer />, label: 'Select All', shortcut: `${mod}A`, action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        ...(supportsApplePencil()
          ? [{
            icon: <FaPencilAlt />,
            label: 'Handwriting\u2026',
            action: requestHandwriting,
            disabled: !editor,
          }]
          : []),
        { icon: <FaSearch />, label: 'Find & Replace…', shortcut: `${mod}F`, action: () => setSearchOpen(true) },
        { icon: <FaHashtag />, label: 'Go to Page…', shortcut: `${mod}G`, action: () => setGoToPageOpen(true) },
        {
          icon: <FaSpellCheck />, label: 'Spelling & Grammar',
          children: [
            { icon: <FaSpellCheck />, label: spellCheckEnabled ? '\u2713 Auto Spell Check' : 'Auto Spell Check', action: toggleSpellCheck },
            { icon: <FaSpellCheck />, label: 'Spell Check\u2026', shortcut: 'F7', action: () => setSpellModalOpen(true) },
            { separator: true, label: '' },
            { icon: <FaSpellCheck />, label: grammarCheckEnabled ? '\u2713 Auto Writing Suggestions' : 'Auto Writing Suggestions', action: toggleGrammarCheck },
            { icon: <FaSpellCheck />, label: 'Writing Suggestions\u2026', shortcut: '\u21e7F7', action: () => setGrammarModalOpen(true) },
            { icon: <FaSpellCheck />, label: 'Grammar & Spelling Settings\u2026', action: () => setGrammarRulesPanelOpen(true) },
          ],
        },
      ],
    },
    {
      label: 'Format',
      items: [
        {
          icon: <FaListOl />, label: 'Element',
          children: [
            {
              label: 'Show Element Menu\u2026',
              shortcut: formatShortcut(elementMenuShortcut),
              title: 'Choose the element for this line, at the cursor',
              action: requestElementMenu,
            },
            { separator: true, label: '' },
            // Title page fields have template rules but are not conversion
            // targets — "make this line of action a copyright notice" is not a
            // thing. They are reached through the Title Page editor.
            ...elementMenuRules.map((r) => {
              const shortcuts: Record<string, string> = {
                sceneHeading: `${mod}1`, action: `${mod}2`, character: `${mod}3`, dialogue: `${mod}4`,
                parenthetical: `${mod}5`, transition: `${mod}6`, general: `${mod}7`, shot: `${mod}8`,
              };
              return {
                label: r.label,
                shortcut: shortcuts[r.id],
                title: ELEMENT_DESCRIPTIONS[r.id],
                action: () => setElement(r.id as any),
              };
            }),
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaBold />, label: 'Style',
          children: [
            { icon: <FaBold />, label: 'Bold', shortcut: `${mod}B`, action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run(), disabled: locked.bold },
            { icon: <FaItalic />, label: 'Italic', shortcut: `${mod}I`, action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run(), disabled: locked.italic },
            { icon: <FaUnderline />, label: 'Underline', shortcut: `${mod}U`, action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run(), disabled: locked.underline },
            { icon: <FaStrikethrough />, label: 'Strikethrough', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run(), disabled: locked.strikethrough },
            { separator: true, label: '' },
            { icon: <FaSubscript />, label: 'Subscript', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleSubscript().run(), disabled: locked.subscript },
            { icon: <FaSuperscript />, label: 'Superscript', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleSuperscript().run(), disabled: locked.superscript },
          ],
        },
        {
          icon: <FaAlignLeft />, label: 'Alignment',
          children: [
            { icon: <FaAlignLeft />, label: 'Align Left', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('left').run(), disabled: locked.textAlign },
            { icon: <FaAlignCenter />, label: 'Align Center', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('center').run(), disabled: locked.textAlign },
            { icon: <FaAlignRight />, label: 'Align Right', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('right').run(), disabled: locked.textAlign },
            { icon: <FaAlignJustify />, label: 'Justify', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('justify').run(), disabled: locked.textAlign },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaColumns />, label: 'Dual Dialogue', shortcut: `${mod}D`, action: () => (editor as any)?.commands?.toggleDualDialogue() },
        {
          // Every AV control under one roof. Three sibling entries (Row,
          // Columns, Storyboard) pushed the Format menu past the bottom of the
          // window on a laptop, and they are one feature, not three.
          //
          // Disabled is set on the leaves, not on a parent: the renderer
          // honours `disabled` on a leaf but opens a submenu regardless, so a
          // screenplay still shows what AV can do rather than hiding it —
          // issue #116 was in the end about discoverability.
          icon: <FaColumns />, label: 'AV Script',
          children: [
            {
              // The way INTO the AV format, and the reason everything below it
              // used to sit permanently greyed out in a normal script: the
              // only route to toggleAvBlock was ⌘⇧A, which an iPad does not
              // have. Deliberately the first item, and never disabled.
              icon: <FaColumns />,
              label: inAvRow ? 'Remove AV Columns' : 'Insert AV Columns',
              shortcut: `${mod}\u21e7A`,
              title: inAvRow
                ? 'Delete this AV table, and everything in it, back to a single line'
                : 'Start a two-column AV table beside this line — Video on the left, Audio on the right. '
                  + 'A line with text is kept; a blank one makes way for the table, and a table already '
                  + 'above or below gains a row instead.',
              disabled: !editor,
              action: () => editor?.chain().focus().toggleAvBlock().run(),
            },
            { separator: true, label: '' },
            {
              // The way OUT of the table.
              //
              // Every other route is a keystroke a soft keyboard does not
              // have, and the AV Script template's starter document is a
              // single avBlock and nothing else — so on a phone the format
              // opened with a table the writer could fill and no way to write
              // a line anywhere but inside it. Tapping the page below does
              // not help either: that area is `.page`, not `.ProseMirror`.
              icon: <FaSignInAlt />,
              label: 'Line After Table',
              disabled: !inAvRow,
              title: inAvRow
                ? 'Put the cursor on an ordinary script line below this AV table, adding one if it is not there yet'
                : avRowHint,
              action: () => editor?.chain().focus().exitAvBlock('after').run(),
            },
            {
              icon: <FaSignInAlt />,
              label: 'Line Before Table',
              disabled: !inAvRow,
              title: inAvRow
                ? 'Put the cursor on an ordinary script line above this AV table, adding one if it is not there yet'
                : avRowHint,
              action: () => editor?.chain().focus().exitAvBlock('before').run(),
            },
            { separator: true, label: '' },
            {
              icon: <FaColumns />, label: 'Row',
              children: [
                { icon: <FaPlus />, label: 'Insert Row Below', shortcut: `${mod}\u21b5`, disabled: !inAvRow, title: avRowHint, action: () => editor?.chain().focus().insertAvRow('below').run() },
                { icon: <FaPlus />, label: 'Insert Row Above', disabled: !inAvRow, title: avRowHint, action: () => editor?.chain().focus().insertAvRow('above').run() },
                { separator: true, label: '' },
                { icon: <FaTimes />, label: 'Delete Row', disabled: !inAvRow, title: avRowHint, action: () => editor?.chain().focus().deleteAvRow().run() },
              ],
            },
            {
              // Column and storyboard controls. Same reasoning as the row
              // controls: every one of these has to be reachable without a
              // hardware keyboard, so the menu is the primary route, not a
              // shortcut.
              icon: <FaColumns />, label: 'Columns',
              children: [
                {
                  icon: <FaClock />,
                  label: avColumns.cue ? '\u2713 Cue / Timing Column' : 'Cue / Timing Column',
                  disabled: !inAvRow, title: avRowHint,
                  action: () => toggleAvColumnChecked('cue'),
                },
                {
                  icon: <FaImage />,
                  label: avColumns.image ? '\u2713 Storyboard Column' : 'Storyboard Column',
                  disabled: !inAvRow, title: avRowHint,
                  action: () => toggleAvColumnChecked('image'),
                },
                { separator: true, label: '' },
                {
                  icon: <FaFileAlt />,
                  label: avRepeatHeaders ? '\u2713 Repeat Headers On Each Page' : 'Repeat Headers On Each Page',
                  disabled: !inAvRow, title: avRowHint,
                  action: () => toggleAvRepeatHeaders(),
                },
                { separator: true, label: '' },
                {
                  icon: <FaColumns />, label: 'Column Width',
                  children: (['video', 'audio', 'cue', 'image'] as const).map((which) => ({
                    icon: <FaColumns />,
                    label: which === 'cue' ? 'Cue' : which === 'image' ? 'Storyboard' : which === 'video' ? 'Video' : 'Audio',
                    children: [
                      { icon: <FaColumns />, label: 'Narrower', disabled: !inAvRow, title: avRowHint, action: () => nudgeAvWidth(which, -0.25) },
                      { icon: <FaColumns />, label: 'Wider', disabled: !inAvRow, title: avRowHint, action: () => nudgeAvWidth(which, 0.25) },
                      { icon: <FaColumns />, label: 'Reset', disabled: !inAvRow, title: avRowHint, action: () => resetAvWidth(which) },
                    ],
                  })),
                },
              ],
            },
            {
              icon: <FaImage />, label: 'Storyboard',
              children: [
                { icon: <FaImage />, label: 'Add / Replace Frame\u2026', disabled: !inAvRow, title: avRowHint, action: () => pickAvFrame() },
                { icon: <FaPlus />, label: 'Add Blank Frame', disabled: !inAvRow, title: avRowHint, action: () => editor?.chain().focus().setAvRowImage(AV_BLANK_FRAME).run() },
                { separator: true, label: '' },
                {
                  icon: <FaImage />, label: 'Frame Aspect Ratio',
                  children: AV_ASPECT_RATIOS.map((ratio) => ({
                    icon: <FaImage />,
                    label: avFrameAspect === ratio ? `\u2713 ${ratio}` : ratio,
                    disabled: !inAvRow,
                    title: avRowHint,
                    // Only the ratio — setAvRowImage merges, so the picture
                    // in the frame (if any) stays exactly where it is.
                    action: () => editor?.chain().focus().setAvRowImage({ aspect: ratio }).run(),
                  })),
                },
                { separator: true, label: '' },
                { icon: <FaTimes />, label: 'Remove Frame', disabled: !inAvRow, title: avRowHint, action: () => editor?.chain().focus().clearAvRowImage().run() },
              ],
            },
          ],
        },
        {
          icon: <FaFileAlt />,
          label: selectionOnNewPage ? '✓ Start On New Page' : 'Start On New Page',
          action: () => {
            if (!editor) return;
            editor.chain().focus(undefined, { scrollIntoView: false }).toggleStartsNewPage().run();
          },
          disabled: !editor,
        },
        { separator: true, label: '' },
        { icon: <FaFont />, label: 'Fonts…', action: () => useEditorStore.getState().setFontsDialogOpen(true) },
        { icon: <FaCommentDots />, label: 'Mores & Continueds…', action: () => useEditorStore.getState().setMoresContdsOpen(true) },
        { icon: <FaHeading />, label: 'Header & Footer…', action: () => useEditorStore.getState().setHeaderFooterOpen(true) },
        { icon: <FaStickyNote />, label: 'Footnotes & Endnotes…', action: () => useEditorStore.getState().setFootnoteDialogOpen(true) },
        { icon: <FaImage />, label: 'Insert Image…', action: () => useEditorStore.getState().imageInsertHandler?.() },
        { separator: true, label: '' },
        { icon: <FaFileAlt />, label: 'Title Page…', action: () => useEditorStore.getState().setTitlePageEditorOpen(true) },
        { icon: <FaStream />, label: 'Genre & Pacing…', title: 'Genres for this script, and the pacing the runtime estimate uses', action: () => useEditorStore.getState().setScriptProfileOpen(true) },
        { icon: <FaFileAlt />, label: `Formatting Template (${activeTemplate.name})...`, action: () => setTemplateSelectOpen(true) },
        { icon: <FaFileAlt />, label: 'Script Format Preferences…', action: () => setFormatPrefsOpen({ firstRun: false, afterSave: null }) },
      ],
    },
    {
      label: 'View',
      items: [
        {
          icon: <FaColumns />, label: 'Panels',
          children: [
            { icon: <FaCompass />, label: navigatorOpen ? '\u2713 Navigator' : 'Navigator', action: toggleNavigator },
            { icon: <FaTh />, label: indexCardsOpen ? '\u2713 Index Cards' : 'Index Cards', action: toggleIndexCards },
            { icon: <FaStream />, label: beatBoardOpen ? '\u2713 Beat Board' : 'Beat Board', action: toggleBeatBoard },
            { icon: <FaStickyNote />, label: scriptNotesOpen ? '\u2713 Notes Panel' : 'Notes Panel', action: () => {
              const hasSelection = editor && !editor.state.selection.empty;
              useEditorStore.getState().setNotesActiveTab(hasSelection ? 'script' : 'general');
              toggleScriptNotes();
            } },
            { icon: <FaUsers />, label: characterProfilesOpen ? '\u2713 Characters' : 'Characters', action: toggleCharacterProfiles },
            { icon: <FaTags />, label: tagsPanelOpen ? '\u2713 Tags' : 'Tags', action: toggleTagsPanel },
            { icon: <FaCompass />, label: locationDatabaseOpen ? '\u2713 Locations' : 'Locations', action: toggleLocationDatabase },
          ],
        },
        {
          icon: <FaHighlighter />, label: 'Highlights',
          children: [
            { icon: <FaHighlighter />, label: notesVisible ? '\u2713 Note Highlights' : 'Note Highlights', action: () => setNotesVisible(!notesVisible) },
            { icon: <FaHighlighter />, label: tagsVisible ? '\u2713 Tag Highlights' : 'Tag Highlights', action: () => setTagsVisible(!tagsVisible) },
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaAdjust />, label: 'Theme',
          children: [
            { icon: <FaSun />, label: appearance === 'light' ? '\u2713 Light' : 'Light', action: () => setAppearance('light') },
            { icon: <FaMoon />, label: appearance === 'dark' ? '\u2713 Dark' : 'Dark', action: () => setAppearance('dark') },
            { icon: <FaRegFileAlt />, label: appearance === 'dark-pages' ? '\u2713 Dark Pages' : 'Dark Pages', action: () => setAppearance('dark-pages') },
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaToolbox />, label: 'Menu & Toolbar',
          children: [
            { icon: <FaCompressArrowsAlt />, label: toolbarMode === 'compact' ? '\u2713 Compact' : 'Compact', action: () => setToolbarMode('compact') },
            { icon: <FaExpandArrowsAlt />, label: toolbarMode === 'comfortable' ? '\u2713 Comfortable' : 'Comfortable', action: () => setToolbarMode('comfortable') },
            { icon: <FaEyeSlash />, label: toolbarMode === 'hidden' ? '\u2713 Hidden' : 'Hidden', action: () => {
              setToolbarMode('hidden');
              if (localStorage.getItem('writeadraft:hiddenModeIntroShown') !== '1') {
                setShowHiddenModeIntro(true);
              }
            }},
          ],
        },
        {
          icon: <FaSearchPlus />, label: `Zoom (${zoomLevel}%)`,
          children: [
            { icon: <FaSearchPlus />, label: 'Zoom In', shortcut: `${mod}+`, action: () => setZoomLevel(Math.min(300, zoomLevel + 10)) },
            { icon: <FaSearchMinus />, label: 'Zoom Out', shortcut: `${mod}−`, action: () => setZoomLevel(Math.max(50, zoomLevel - 10)) },
            { separator: true, label: '' },
            { label: zoomLevel === 50 ? '\u2713 50%' : '50%', action: () => setZoomLevel(50) },
            { label: zoomLevel === 75 ? '\u2713 75%' : '75%', action: () => setZoomLevel(75) },
            { label: zoomLevel === 100 ? '\u2713 100%' : '100%', action: () => setZoomLevel(100) },
            { label: zoomLevel === 125 ? '\u2713 125%' : '125%', action: () => setZoomLevel(125) },
            { label: zoomLevel === 150 ? '\u2713 150%' : '150%', action: () => setZoomLevel(150) },
            { label: zoomLevel === 200 ? '\u2713 200%' : '200%', action: () => setZoomLevel(200) },
            { label: zoomLevel === 300 ? '\u2713 300%' : '300%', action: () => setZoomLevel(300) },
          ],
        },
      ],
    },
    {
      label: 'Tools',
      items: [
        { icon: <FaBoxes />, label: 'Asset Manager', action: () => useAssetStore.getState().toggleAssetManager() },
        { separator: true, label: '' },
        {
          icon: <FaStream />, label: 'Analytics',
          children: [
            { icon: <FaStream />, label: 'Script Statistics', action: () => {
              const s = useEditorStore.getState();
              s.setStatisticsScrollTo(null);
              s.setStatisticsOpen(true);
            } },
            { icon: <FaHistory />, label: 'Timing Report', action: () => {
              const s = useEditorStore.getState();
              s.setStatisticsScrollTo('stats-timing-report');
              s.setStatisticsOpen(true);
            } },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaCog />, label: 'System Settings…', action: goToSettings },
        { separator: true, label: '' },
        {
          icon: <FaFilm />, label: 'Production',
          children: [
            { icon: <FaToggleOn />, label: revisionMode ? '\u2713 Revision Mode' : 'Revision Mode', action: () => setRevisionMode(!revisionMode) },
            {
              icon: <FaHighlighter />, label: `Revision Color (${revisionColor})`,
              children: REVISION_COLORS.map((c) => ({
                label: c.name === revisionColor ? `\u2713 ${c.name}` : c.name,
                action: () => setRevisionColor(c.name),
              })),
            },
            {
              icon: <FaStepForward />, label: 'Next Revision Color',
              title: `Start the ${nextRevisionColor(revisionColor)} revision and turn Revision Mode on`,
              action: () => {
                advanceRevisionColor();
                showToast(`Revising in ${useEditorStore.getState().revisionColor}`, 'info');
              },
            },
            {
              icon: <FaEye />,
              label: showRevisionColors ? '\u2713 Show Revision Colors' : 'Show Revision Colors',
              action: () => setShowRevisionColors(!showRevisionColors),
            },
            { icon: <FaEraser />, label: 'Clear Revision Marks\u2026', action: () => setClearRevisionsOpen(true), disabled: !editor },
            {
              icon: <FaSlidersH />, label: 'Revision Settings\u2026',
              title: 'The revision mark, a mark for each revision, and colored pages',
              action: () => setRevisionSettingsOpen(true),
            },
            { separator: true, label: '' },
            {
              icon: <FaListUl />,
              label: sceneNumbersVisible ? '\u2713 Show Scene Numbers' : 'Show Scene Numbers',
              action: () => setSceneNumbersVisible(!sceneNumbersVisible),
            },
            {
              icon: <FaLock />,
              label: sceneNumbersLocked ? '\u2713 Lock Scene Numbers' : 'Lock Scene Numbers',
              action: () => setSceneNumbersLocked(!sceneNumbersLocked),
              // Unlocking is always allowed; locking needs numbers to lock.
              disabled: !sceneNumbersVisible && !sceneNumbersLocked,
            },
            {
              icon: <FaBan />, label: 'Omit Scene',
              title: sceneNumbersLocked
                ? 'Replace the scene at the cursor with an OMITTED heading that keeps its number'
                : 'Lock scene numbers first — an unlocked script can simply delete the scene',
              action: handleOmitScene,
              disabled: !editor || !sceneNumbersLocked,
            },
            { separator: true, label: '' },
            {
              icon: pageLabels ? <FaUnlock /> : <FaLock />,
              label: pageLabels ? 'Unlock Pages' : 'Lock Pages',
              title: pageLabels
                ? 'Let page numbers flow again; A pages are renumbered'
                : 'Keep every page number where it is; new text spills onto A pages',
              action: handleToggleLockPages,
              disabled: !editor,
            },
          ],
        },
      ],
    },
  ];

  // Help sits at the right-hand end of the bar, after the spacer.
  const helpMenu: MenuSection = {
    label: 'Help',
    items: [
      {
        icon: <FaBook />,
        label: 'User Manual\u2026',
        action: () => setManualOpen(true),
      },
      { separator: true, label: '' },
      {
        icon: <FaInfoCircle />,
        label: 'About WriTea Draft',
        action: () => setAboutOpen(true),
      },
      {
        icon: <FaStethoscope />,
        label: 'Diagnostics',
        action: () => { void handleOpenDiagnostics(); },
      },
    ],
  };

  // Append plugin menu items to each section (supports nested submenus)
  const pluginCtx = { editor };
  const mapPluginChildren = (children: any[]): MenuItem[] =>
    children.map((c) => ({
      label: c.label || '',
      shortcut: c.shortcut,
      action: c.action ? () => c.action!(pluginCtx) : undefined,
      disabled: typeof c.disabled === 'function' ? c.disabled(pluginCtx) : c.disabled,
      separator: c.separator,
      children: c.children ? mapPluginChildren(c.children) : undefined,
    }));
  for (const menu of menus) {
    const pluginItems = pluginRegistry.getMenuItems(menu.label as PluginMenuSection);
    if (pluginItems.length > 0) {
      menu.items.push({ separator: true, label: '' });
      for (const p of pluginItems) {
        menu.items.push({
          label: p.label,
          shortcut: p.shortcut,
          action: p.action ? () => p.action!(pluginCtx) : undefined,
          disabled: typeof p.disabled === 'function' ? p.disabled(pluginCtx) : p.disabled,
          children: p.children ? mapPluginChildren(p.children) : undefined,
        });
      }
    }
  }

  // Track the active menu item's position for the portal dropdown
  const menuItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // `maxHeight` keeps a long menu (Format, on a short window in comfortable
  // density) inside the viewport instead of running off the bottom where the
  // last few items cannot be reached at all. Submenus are positioned fixed, so
  // they still fly out past the scroll container.
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight?: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!activeMenu) return;
    const el = menuItemRefs.current[activeMenu];
    if (el) {
      const rect = el.getBoundingClientRect();
      const dropdownWidth = 260; // min-width of .menu-dropdown
      // Clamped at both ends. Without the lower bound a viewport narrower than
      // the dropdown pushes `left` negative and the menu hangs off the leading
      // edge. Not reachable at the 320pt minimum this app supports, but the
      // expression should not be the thing standing between here and there.
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8));

      // In floating mode, position relative to the panel edges (not individual items)
      // so the dropdown clears the rounded, padded floating menu panel.
      const fit = (edge: number) => Math.max(160, window.innerHeight - edge - 8);
      if (toolbarMode === 'hidden' && menuRef.current) {
        const panelRect = menuRef.current.getBoundingClientRect();
        if (panelRect.bottom > window.innerHeight * 0.55) {
          const bottom = window.innerHeight - panelRect.top + 4;
          setDropdownPos({ bottom, left, top: undefined, maxHeight: fit(bottom) });
        } else {
          const top = panelRect.bottom + 4;
          setDropdownPos({ top, left, bottom: undefined, maxHeight: fit(top) });
        }
      } else {
        setDropdownPos({ top: rect.bottom, left, bottom: undefined, maxHeight: fit(rect.bottom) });
      }
    }
  }, [activeMenu, toolbarMode]);

  // Floating menu toggle (hidden mode)
  const [floatingMenuOpen, setFloatingMenuOpen] = useState(false);
  const [showHiddenModeIntro, setShowHiddenModeIntro] = useState(false);
  const [hiddenModeDontShow, setHiddenModeDontShow] = useState(true);

  // Draggable FAB position — persisted to localStorage
  const FAB_POS_KEY = 'writeadraft:fabPosition';
  const FAB_SIZE = 36;
  // How far down the window the iPadOS window control reaches, plus room for
  // the FAB itself — below this the corner is the app's own again.
  const FAB_PILL_BAND_PX = 56;
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const s = localStorage.getItem('writeadraft:fabPosition');
      if (s) {
        const p = JSON.parse(s);
        return {
          x: Math.max(0, Math.min(p.x, window.innerWidth - 36)),
          y: Math.max(0, Math.min(p.y, window.innerHeight - 36)),
        };
      }
    } catch {}
    return null;
  });
  const fabDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; isDrag: boolean } | null>(null);
  const fabWasDragRef = useRef(false);
  const fabX = fabPos?.x ?? (navPanelWidth + 14);
  const fabY = fabPos?.y ?? 10;
  // On Android the WebView extends behind the (transparent) status bar, so a
  // FAB rendered at top: 10px sits in the system-bar touch region and never
  // receives taps. Clamp the rendered top below the status bar (28dp fallback
  // when env() reports 0, otherwise the real inset).
  const isAndroidWebView = typeof document !== 'undefined'
    && document.documentElement.classList.contains('android');
  const fabTopStyle = isAndroidWebView
    ? `max(${fabY}px, calc(max(env(safe-area-inset-top), 28px) + 8px))`
    : `max(${fabY}px, calc(env(safe-area-inset-top, 0px) + 8px))`;
  // Same problem on the other axis: iPadOS draws its window-management pill
  // over the top-leading corner of a windowed app, and the FAB's default spot
  // is right underneath it. This FAB *is* the menu while the toolbar is
  // hidden, so a buried one leaves no way to reach anything (issue #66).
  // --ios-window-gutter is 0 unless the app is in a window, and the clamp only
  // applies in the band the pill occupies — lower down, the leading edge is
  // the user's to park on.
  const fabLeftStyle = fabY < FAB_PILL_BAND_PX
    ? `max(${fabX}px, calc(env(safe-area-inset-left, 0px) + var(--ios-window-gutter, 0px)))`
    : `max(${fabX}px, env(safe-area-inset-left, 0px))`;

  // Desktop: pointer events with capture for mouse drag
  const handleFabPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // Touch handled separately below
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    fabDragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: fabPos?.x ?? (navPanelWidth + 14),
      originY: fabPos?.y ?? 10,
      isDrag: false,
    };
  }, [fabPos, navPanelWidth]);

  const handleFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const d = fabDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.isDrag && Math.abs(dx) + Math.abs(dy) > 5) {
      d.isDrag = true;
      setFloatingMenuOpen(false);
    }
    if (d.isDrag) {
      setFabPos({
        x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + dy)),
      });
    }
  }, [FAB_SIZE]);

  const handleFabPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const d = fabDragRef.current;
    fabDragRef.current = null;
    if (!d) return;
    fabWasDragRef.current = true;
    if (d.isDrag) {
      const pos = {
        x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + (e.clientX - d.startX))),
        y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + (e.clientY - d.startY))),
      };
      setFabPos(pos);
      localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
    } else {
      setFloatingMenuOpen(prev => !prev);
    }
  }, [FAB_POS_KEY, FAB_SIZE]);

  // Touch: native listeners on the FAB element via ref (WKWebView + Android WebView)
  const fabElRef = useRef<HTMLDivElement>(null);
  const fabPosRef = useRef(fabPos);
  fabPosRef.current = fabPos;
  const navPanelWidthRef = useRef(navPanelWidth);
  navPanelWidthRef.current = navPanelWidth;

  useEffect(() => {
    const el = fabElRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.stopPropagation(); // Prevent swipe handlers on parent elements
      const t = e.touches[0];
      const pos = fabPosRef.current;
      fabDragRef.current = {
        startX: t.clientX, startY: t.clientY,
        originX: pos?.x ?? (navPanelWidthRef.current + 14),
        originY: pos?.y ?? 10,
        isDrag: false,
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = fabDragRef.current;
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;
      if (!d.isDrag && Math.abs(dx) + Math.abs(dy) > 5) {
        d.isDrag = true;
        setFloatingMenuOpen(false);
      }
      if (d.isDrag) {
        e.preventDefault();
        e.stopPropagation();
        setFabPos({
          x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + dy)),
        });
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = fabDragRef.current;
      fabDragRef.current = null;
      if (!d) return;
      if (d.isDrag) {
        fabWasDragRef.current = true;
        // Reset after a short delay so the flag doesn't block future taps
        // (onClick may not fire on mobile after a drag to reset it)
        setTimeout(() => { fabWasDragRef.current = false; }, 400);
        const t = e.changedTouches[0];
        const pos = {
          x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + (t.clientX - d.startX))),
          y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + (t.clientY - d.startY))),
        };
        setFabPos(pos);
        localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [FAB_POS_KEY, FAB_SIZE, toolbarMode]);

  // Click: fallback for tap (works everywhere)
  const handleFabClick = useCallback(() => {
    if (fabWasDragRef.current) {
      fabWasDragRef.current = false;
      return;
    }
    setFloatingMenuOpen(prev => !prev);
  }, []);

  // Icon map for menu labels
  const menuIcons: Record<string, React.ReactNode> = {
    File: <FaFile />,
    Edit: <FaPencilAlt />,
    Format: <FaPalette />,
    View: <FaEye />,
    Tools: <FaWrench />,
  };

  // Find the active menu's items (search both main menus and help)
  const activeMenuData = activeMenu
    ? menus.find(m => m.label === activeMenu) || (activeMenu === 'Help' ? helpMenu : null)
    : null;

  // Close floating menu when clicking outside (but not on the dropdown portal or FAB)
  useEffect(() => {
    if (!floatingMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current && !menuRef.current.contains(target)) {
        // Don't close if clicking inside the dropdown portal or a submenu
        if (target.closest('.menu-dropdown') || target.closest('.menu-fab')) return;
        setFloatingMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [floatingMenuOpen]);

  const menuBarClass = toolbarMode === 'comfortable' ? 'menu-bar chrome-comfortable' : 'menu-bar';

  const renderMenuItems = () => (
    <>
      {menus.map((menu) => (
        <div
          key={menu.label}
          ref={(el) => { menuItemRefs.current[menu.label] = el; }}
          className={`menu-item ${activeMenu === menu.label ? 'active' : ''}`}
          onMouseDown={keepEditorSelection}
          onClick={() => handleMenuClick(menu.label)}
          onMouseEnter={() => {
            if (activeMenu) setActiveMenu(menu.label);
          }}
        >
          {menuIcons[menu.label] && <span className="menu-icon">{menuIcons[menu.label]}</span>}
          <span className="menu-label">{menu.label}</span>
        </div>
      ))}
      <div
        ref={(el) => { menuItemRefs.current['Help'] = el; }}
        className={`menu-item ${activeMenu === 'Help' ? 'active' : ''}`}
        onMouseDown={keepEditorSelection}
        onClick={() => handleMenuClick('Help')}
        onMouseEnter={() => {
          if (activeMenu) setActiveMenu('Help');
        }}
        title="User manual, about and diagnostics"
      >
        <span className="menu-icon"><FaQuestionCircle /></span>
        <span className="menu-label">Help</span>
      </div>
      <div className="menu-spacer" />
      <AuthIndicator />
    </>
  );

  return (
    <>
    {toolbarMode === 'hidden' ? (
      createPortal(
        <>
          <div
            ref={fabElRef}
            className={`menu-fab ${floatingMenuOpen ? 'menu-fab--open' : ''}`}
            style={{ left: fabLeftStyle, top: fabTopStyle }}
            onPointerDown={handleFabPointerDown}
            onPointerMove={handleFabPointerMove}
            onPointerUp={handleFabPointerUp}
            onClick={handleFabClick}
            onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
            title="Menu (drag to reposition)"
          >
            <FaBars />
          </div>
          {floatingMenuOpen && (() => {
            const fabInBottom = fabY > window.innerHeight * 0.55;
            const fabInRight = fabX > window.innerWidth * 0.5;
            const mStyle: React.CSSProperties = {};
            if (fabInBottom) {
              mStyle.bottom = window.innerHeight - fabY + 8;
            } else {
              mStyle.top = fabY + FAB_SIZE + 8;
            }
            if (fabInRight) {
              mStyle.right = window.innerWidth - fabX - FAB_SIZE;
            } else {
              mStyle.left = fabX;
            }
            return (
              <div className="menu-bar chrome-comfortable menu-bar--floating" style={mStyle} ref={menuRef}>
                {renderMenuItems()}
              </div>
            );
          })()}
        </>,
        document.body,
      )
    ) : (
      <div className={menuBarClass} ref={menuRef}>
        {renderMenuItems()}
      </div>
    )}
    {activeMenuData && createPortal(
      <div
        className={`menu-dropdown${toolbarMode === 'comfortable' ? ' menu-dropdown--comfortable' : ''}${dropdownPos.bottom != null ? ' menu-dropdown--above' : ''}`}
        onMouseDown={keepEditorSelection}
        style={{ top: dropdownPos.top, bottom: dropdownPos.bottom, left: dropdownPos.left, maxHeight: dropdownPos.maxHeight }}
      >
        {activeMenuData.items.map((item, i) => renderMenuNode(item, '', i))}
      </div>,
      document.body,
    )}
    {showHiddenModeIntro && createPortal(
      <div className="dialog-overlay" onClick={() => setShowHiddenModeIntro(false)}>
        <div className="hidden-mode-intro" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Hidden Mode</div>
          <div className="hidden-mode-intro-body">
            <div className="hidden-mode-intro-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="var(--fd-accent)" strokeWidth="1.5">
                <circle cx="20" cy="20" r="18" fill="var(--fd-overlay-subtle)" />
                <line x1="14" y1="14" x2="14" y2="26" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="20" y1="14" x2="20" y2="26" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="26" y1="14" x2="26" y2="26" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <p>The menu bar is now hidden. A <strong>floating menu button</strong> has been placed on screen to access all menus.</p>
            <p>You can <strong>drag the button</strong> to reposition it anywhere on screen. Your preferred position will be remembered.</p>
            <p>To restore the menu bar, tap the button and go to <strong>View &gt; Menu &amp; Toolbar</strong>.</p>
          </div>
          <div className="dialog-footer" style={{ flexDirection: 'column', gap: '12px', alignItems: 'stretch' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fd-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={hiddenModeDontShow} onChange={(e) => setHiddenModeDontShow(e.target.checked)} />
              Don't show this again
            </label>
            <button className="dialog-btn dialog-btn-primary" onClick={() => {
              if (hiddenModeDontShow) localStorage.setItem('writeadraft:hiddenModeIntroShown', '1');
              setShowHiddenModeIntro(false);
            }}>Got it</button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    {checkinOpen && (
      <div className="dialog-overlay" onClick={() => setCheckinOpen(false)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Check In Version</div>
          <div className="dialog-body">
            <div className="dialog-row">
              <label>Version Description</label>
              <input
                ref={checkinInputRef}
                value={checkinMessage}
                onChange={(e) => setCheckinMessage(e.target.value)}
                placeholder="Describe what changed..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && checkinMessage.trim()) handleCheckinSubmit();
                  if (e.key === 'Escape') setCheckinOpen(false);
                }}
              />
            </div>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setCheckinOpen(false)}>Cancel</button>
            <button
              className="dialog-primary"
              onClick={handleCheckinSubmit}
              disabled={checkinSaving || !checkinMessage.trim()}
            >
              {checkinSaving ? 'Saving...' : 'Check In'}
            </button>
          </div>
        </div>
      </div>
    )}
    {pageSetupOpen && (
      <PageSetupDialog onClose={() => setPageSetupOpen(false)} />
    )}
    {templateSelectOpen && (
      <TemplateSelectDialog editor={editor} onClose={() => setTemplateSelectOpen(false)} />
    )}
    {formatPrefsOpen && (
      <ScriptFormatPreferencesDialog
        firstRun={formatPrefsOpen.firstRun}
        onConfirm={(ids) => {
          const next = formatPrefsOpen;
          setFormatPrefsOpen(null);
          if (next?.afterSave === 'apply-new-screenplay') {
            // After saving prefs, immediately route the new-screenplay action through
            // the same logic again (1 enabled = apply directly, 2+ = show picker
            // with the default selected).
            if (ids.length === 1) finishNewScreenplayWithFormat(ids[0], formatPickerMode);
            else if (ids.length > 1) setFormatPickerOpen(true);
            else finishNewScreenplayWithFormat(INDUSTRY_STANDARD_ID, formatPickerMode);
          }
        }}
        onCancel={() => setFormatPrefsOpen(null)}
      />
    )}
    {formatPickerOpen && (
      <ScriptFormatPickerDialog
        enabledIds={useSettingsStore.getState().enabledScriptFormats}
        defaultId={useSettingsStore.getState().defaultScriptFormat}
        onPick={(id) => {
          setFormatPickerOpen(false);
          finishNewScreenplayWithFormat(id, formatPickerMode);
        }}
        onCancel={() => setFormatPickerOpen(false)}
      />
    )}
    {backupFolderPrompt && (
      <BackupFolderPrompt
        then={backupFolderPrompt}
        onClose={() => setBackupFolderPrompt(null)}
        onFolderChosen={() => {
          if (backupFolderPrompt === 'backup') void backUpNow();
          else void openBackupFolder();
        }}
      />
    )}
    <RecoverBackupDialog
      open={recoverBackupOpen}
      onClose={() => setRecoverBackupOpen(false)}
      // Lets the dialog save a safety copy of what's on screen before a
      // destructive "Replace Current Script".
      onBeforeReplace={() => {
        const content = buildSaveContent();
        if (!content) return undefined;
        return { content, title: useEditorStore.getState().documentTitle || 'Untitled' };
      }}
    />

    {aboutOpen && (
      <div className="dialog-overlay" onClick={() => setAboutOpen(false)}>
        <div className="dialog-box about-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">About WriTea Draft</div>
          <div className="dialog-body about-body">
            <div className="about-title">WriTea Draft</div>
            <div className="about-version">Version 1.0.0</div>
            <div className="about-tagline">Free, open-source screenwriting software</div>

            <div className="about-whats-new">
              <div className="about-section-title">What's New in 1.0.0</div>
              <div className="about-changelog">
              <div className="about-subsection-title">v1.0.0</div>
              <ul className="about-list">
                <li><strong>Hello, WriTea Draft.</strong> This is the first release under the new name. WriTea Draft is built on OpenDraft by Proteus Technologies, and brings its full set of screenwriting tools along.</li>
                <li><strong>A New Look.</strong> A new logo (a teacup and a quill on a cornflower tile), with a matching app icon on every platform and a new startup screen.</li>
              </ul>
              </div>
            </div>

            <div className="about-whats-new">
              <button
                className="about-disclosure"
                aria-expanded={compatOpen}
                onClick={() => setCompatOpen((v) => !v)}
              >
                <span className="about-disclosure-caret">&#9654;</span>
                <span className="about-section-title" style={{ margin: 0 }}>Compatibility</span>
              </button>
              {compatOpen && (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--fd-text-secondary)' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>Subsystem</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>Status</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>Implementation</th>
                  </tr>
                </thead>
                <tbody>
                  {getCompatEntries().map((entry) => (
                    <React.Fragment key={entry.label}>
                      <tr>
                        <td style={{ padding: '4px 8px', color: 'var(--fd-text)' }}>{entry.label}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: entry.mode === 'primary' ? '#4caf50' : '#ff9800',
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }} />
                          <span style={{ color: entry.mode === 'primary' ? '#4caf50' : '#ff9800', verticalAlign: 'middle' }}>
                            {entry.mode === 'primary' ? 'Latest' : 'Fallback'}
                          </span>
                        </td>
                        <td style={{ padding: '4px 8px', color: 'var(--fd-text-secondary)', fontSize: 11 }}>
                          {entry.using}
                        </td>
                      </tr>
                      {entry.errorReason && (
                        <tr>
                          <td colSpan={3} style={{ padding: '0 8px 8px 8px' }}>
                            <pre style={{
                              margin: 0,
                              padding: '6px 8px',
                              fontSize: 11,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              background: '#f4f4f4',
                              border: '1px solid #ddd',
                              borderRadius: 4,
                              color: '#1a1a1a',
                            }}>{entry.errorReason}</pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </div>
          <div className="dialog-actions">
            <button className="dialog-primary" onClick={() => setAboutOpen(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    {manualOpen && <UserManualDialog onClose={() => setManualOpen(false)} />}
    {diagnosticsOpen && (
      <div className="dialog-overlay" onClick={() => setDiagnosticsOpen(false)}>
        <div className="dialog-box about-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Diagnostics</div>
          <div className="dialog-body about-body">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-secondary)' }}>
              Runtime info to attach to bug reports. Click "Copy" to copy the
              full report to your clipboard, then paste it into the GitHub issue.
            </p>
            {diagnosticsReport ? (
              <>
                {diagnosticsReport.oneDriveSuspect && (
                  <div style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    background: '#fff8e1',
                    border: '1px solid #ffcc80',
                    borderRadius: 4,
                    color: '#8b5a00',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}>
                    <strong>OneDrive interference suspected.</strong> Your app
                    data folder appears to be inside a OneDrive-synced
                    location. OneDrive can corrupt SQLite WAL files mid-write,
                    causing silent save failures. To fix this, exclude
                    WriTea Draft's data folder from OneDrive backup, or move your
                    Windows AppData folder out of OneDrive sync.
                  </div>
                )}
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 12 }}>
                  <tbody>
                    <DiagRow label="Version" value={diagnosticsReport.appVersion} />
                    <DiagRow label="OS" value={diagnosticsReport.os} />
                    <DiagRow label="Storage backend" value={diagnosticsReport.storageMode} />
                    {diagnosticsReport.storageError && (
                      <DiagRow label="Storage error" value={diagnosticsReport.storageError} mono />
                    )}
                    {diagnosticsReport.appDataDir && (
                      <DiagRow label="App data dir" value={diagnosticsReport.appDataDir} mono />
                    )}
                    {diagnosticsReport.sqliteDbPath && (
                      <DiagRow label="SQLite DB path" value={diagnosticsReport.sqliteDbPath} mono />
                    )}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ marginTop: 12, color: 'var(--fd-text-secondary)' }}>Loading…</div>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="dialog-secondary"
              onClick={handleCopyDiagnostics}
              disabled={!diagnosticsReport}
            >
              {diagnosticsCopied ? 'Copied ✓' : 'Copy Report'}
            </button>
            <button className="dialog-primary" onClick={() => setDiagnosticsOpen(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    {scriptProfileOpen && (
      <ScriptProfileDialog
        onClose={() => useEditorStore.getState().setScriptProfileOpen(false)}
        getDoc={getEditorDoc}
      />
    )}
    {revisionSettingsOpen && (
      <RevisionSettingsDialog onClose={() => setRevisionSettingsOpen(false)} />
    )}
    {clearRevisionsOpen && (
      <div className="dialog-overlay" onClick={() => setClearRevisionsOpen(false)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="dialog-header">Clear Revision Marks</div>
          <div className="dialog-body">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--fd-text)' }}>
              Remove every revision asterisk from this script? The text itself is not changed, and Edit &rarr; Undo brings the marks back.
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setClearRevisionsOpen(false)}>Cancel</button>
            <button
              className="dialog-primary"
              onClick={() => {
                setClearRevisionsOpen(false);
                try {
                  editor?.chain().focus().clearRevisionMarks().run();
                  // The dialog's button had focus; once it unmounts focus
                  // falls to <body>. Put it back in the script so the Undo
                  // the dialog promises is one keystroke away.
                  requestAnimationFrame(() => { if (editor && !editor.isDestroyed) editor.commands.focus(); });
                  showToast('Revision marks cleared', 'success');
                } catch (err) {
                  console.error('[revisions] clear failed', err);
                  showToast(`Could not clear revision marks: ${err instanceof Error ? err.message : String(err)}`, 'error');
                }
              }}
            >
              Clear Marks
            </button>
          </div>
        </div>
      </div>
    )}
    {discardConfirmOpen && (
      <div className="dialog-overlay" onClick={handleDiscardConfirmCancel}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Unsaved Changes</div>
          <div className="dialog-body">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--fd-text)' }}>
              You have unsaved changes. Would you like to save before proceeding?
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={handleDiscardConfirmCancel}>Cancel</button>
            <button onClick={handleDiscardConfirmDiscard}>Discard</button>
            <button className="dialog-primary" onClick={handleDiscardConfirmSave}>Save &amp; Continue</button>
          </div>
        </div>
      </div>
    )}
    {inPlaceElsewhere && (
      <DocumentOpenElsewhereDialog
        other={inPlaceElsewhere.other}
        documentTitle={inPlaceElsewhere.document.name}
        onSwitch={async () => {
          const target = inPlaceElsewhere.other.window;
          setInPlaceElsewhere(null);
          try {
            await focusWindow(target);
          } catch (err) {
            showToast(
              `Could not switch windows: ${err instanceof Error ? err.message : String(err)}`,
              'error',
            );
          }
        }}
        onOpenAnyway={() => {
          const pending = inPlaceElsewhere.document;
          setInPlaceElsewhere(null);
          applyInPlaceDocument(pending);
        }}
      />
    )}
    {foreignFormatNotice && (
      <div className="dialog-overlay" onClick={() => setForeignFormatNotice(null)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="dialog-header">Editing a .{foreignFormatNotice.extension} file</div>
          <div className="dialog-body">
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              Save now writes straight back to <strong>{foreignFormatNotice.name}</strong>.
            </p>
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              That file is in another application&apos;s format, and it can only hold
              what that format defines. Saving to it rewrites the file from
              WriTea Draft&apos;s copy of the screenplay, so layout details it does not
              describe may come back slightly differently — and anything WriTea Draft
              keeps alongside the script has nowhere to go:
            </p>
            <ul style={{ margin: '0 0 8px 18px', fontSize: 13, color: 'var(--fd-text)' }}>
              <li>notes, tags and beats</li>
              <li>character profiles and relationships</li>
              <li>revision marks and version history</li>
            </ul>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted, #888)' }}>
              To keep all of it, use <strong>Save As</strong> to store the screenplay in
              WriTea Draft&apos;s own library instead. The original file stays where it is,
              untouched.
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setForeignFormatNotice(null)}>
              Keep editing the file
            </button>
            <button
              className="dialog-primary"
              onClick={() => {
                setForeignFormatNotice(null);
                handleSaveAs();
              }}
            >
              Save As…
            </button>
          </div>
        </div>
      </div>
    )}
    {avColumnWarning && (() => {
      const isCue = avColumnWarning.which === 'cue';
      const rows = avColumnWarning.rows;
      const what = isCue
        ? `${rows} ${rows === 1 ? 'shot has' : 'shots have'} a time on`
        : `${rows} ${rows === 1 ? 'row has' : 'rows have'} a storyboard frame in`;
      return (
        <div className="dialog-overlay" onClick={() => setAvColumnWarning(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              Hide the {isCue ? 'Cue / Timing' : 'Storyboard'} Column?
            </div>
            <div className="dialog-body">
              <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
                {what} it. Hiding the column takes {isCue ? 'those times' : 'them'} out
                of the script on screen, off the printed page, and out of
                exported spreadsheets and PDFs.
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted, #888)' }}>
                Nothing is deleted — {isCue ? 'the times' : 'the frames'} stay with their
                rows, and turning the column back on brings them back exactly as
                they are now.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setAvColumnWarning(null)}>Cancel</button>
              <button className="dialog-primary" onClick={confirmAvColumnToggle}>Hide Column</button>
            </div>
          </div>
        </div>
      );
    })()}
    {docxImportWarningOpen && (
      <div className="dialog-overlay" onClick={() => setDocxImportWarningOpen(false)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Import from Word — Best-Effort Formatting</div>
          <div className="dialog-body">
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              WriTea Draft will detect screenplay element types (scene heading, action,
              character, dialogue, parenthetical, transition, etc.) from the
              Word document&apos;s formatting.
            </p>
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              Detection is <strong>best-effort</strong> and depends on consistent
              formatting being applied throughout the document. Results will be
              accurate if you used:
            </p>
            <ul style={{ margin: '0 0 8px 18px', fontSize: 13, color: 'var(--fd-text)' }}>
              <li>Final Draft, Fade In, Trelby, or Highland style names, OR</li>
              <li>Standard Final Draft indents (Action 1.5&quot;, Character 3.5&quot;, Dialogue 2.5&quot;, Parenthetical 3.0&quot;), OR</li>
              <li>Conventional text patterns (INT./EXT., ALL-CAPS character cues, &quot;CUT TO:&quot; transitions).</li>
            </ul>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted, #888)' }}>
              Anything that can&apos;t be classified will be imported as Action and
              listed in a post-import notice for you to review.
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setDocxImportWarningOpen(false)}>Cancel</button>
            <button className="dialog-primary" onClick={handleConfirmDocxImport}>Continue</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default MenuBar;
