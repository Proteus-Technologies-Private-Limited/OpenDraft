import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, DEFAULT_TAG_CATEGORIES } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import { downloadFDX } from '../utils/fdxExporter';
import { downloadFountain } from '../utils/fountainExporter';
import { exportPDF } from '../utils/pdfExporter';
import { trackChangesPluginKey } from '../editor/trackChanges';
import PageSetupDialog from './PageSetupDialog';
import TemplateSelectDialog from './TemplateSelectDialog';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';
import { pluginRegistry } from '../plugins/registry';
import { clearEditorHistory } from '../editor/clearHistory';
import { openTextFile } from '../utils/fileOps';
import { isDesktopTauri } from '../services/platform';
import { getCompatEntries } from '../services/compat';
import type { MenuSection as PluginMenuSection } from '../plugins/registry';
import {
  FaFile,
  FaPlus,
  FaPencilAlt,
  FaPalette,
  FaEye,
  FaWrench,
  FaEllipsisH,
  FaFileImport,
  FaFolderOpen,
  FaSave,
  FaFileExport,
  FaFileCode,
  FaFilePdf,
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
  FaCompass,
  FaTh,
  FaStream,
  FaStickyNote,
  FaUsers,
  FaTags,
  FaHighlighter,
  FaAdjust,
  FaToolbox,
  FaUserFriends,
  FaSignInAlt,
  FaProjectDiagram,
  FaFilm,
  FaBoxes,
  FaBars,
  FaInfoCircle,
  FaKeyboard,
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
} from 'react-icons/fa';

interface MenuBarProps {
  editor: Editor | null;
  onCollaborate?: () => void;
  onJoinCollab?: () => void;
  isCollabActive?: boolean;
  isCollabGuest?: boolean;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  children?: MenuItem[];
  icon?: React.ReactNode;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const MenuBar: React.FC<MenuBarProps> = ({ editor, onCollaborate, onJoinCollab, isCollabActive, isCollabGuest }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Platform-aware modifier key symbol for shortcut labels
  const mod = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
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
    notesVisible,
    setNotesVisible,
    tagsVisible,
    setTagsVisible,
    revisionMode,
    setRevisionMode,
    documentTitle,
    pageLayout,
    setSearchOpen,
    setGoToPageOpen,
    spellCheckEnabled,
    toggleSpellCheck,
    setOpenFromProjectOpen,
    setPostSaveAction,
    setSaveAsOpen,
    theme,
    setTheme,
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
  } = useEditorStore();

  const {
    currentProject,
    currentScriptId,
    setCurrentProject,
    setCurrentScriptId,
    setScripts,
    setVersionHistoryOpen,
  } = useProjectStore();

  // Build a saveable content object: editor JSON + store metadata at top level
  const buildSaveContent = useCallback((): Record<string, unknown> | undefined => {
    if (!editor || editor.isDestroyed) return undefined;
    const store = useEditorStore.getState();
    const doc = editor.getJSON();
    return {
      ...doc,
      _notes: store.notes,
      _generalNotes: store.generalNotes,
      _tags: store.tags,
      _tagCategories: store.tagCategories,
      _characterProfiles: store.characterProfiles,
      _beats: store.beats,
      _beatColumns: store.beatColumns,
      _beatArrangeMode: store.beatArrangeMode,
      _sceneNumbersVisible: store.sceneNumbersVisible,
      _sceneNumbersLocked: store.sceneNumbersLocked,
      _pageLayout: store.pageLayout,
    };
  }, [editor]);

  // ── Save current editor content to backend ──
  const handleSave = useCallback(async () => {
    if (!editor) return;
    if (!currentProject || !currentScriptId) {
      // No project yet — prompt user for project & file name
      setSaveAsOpen(true);
      return;
    }
    try {
      const content = buildSaveContent();
      await api.saveScript(currentProject.id, currentScriptId, { content });
      showToast('Saved', 'success');
    } catch (err) {
      console.error('Save failed:', err);
      showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, currentProject, currentScriptId, buildSaveContent, setSaveAsOpen]);

  // ── Unsaved-changes confirmation before New / Import ──
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  /** Returns true if the editor has unsaved changes worth prompting about.
   *  - If never saved to a project: true when editor has any meaningful text.
   *  - If saved to a project: always false (auto-save handles it). */
  const editorHasUnsavedChanges = useCallback((): boolean => {
    if (!editor) return false;
    // Already saved to a project — auto-save keeps it in sync, no prompt needed
    if (currentProject && currentScriptId) return false;
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
    if (!currentProject || !currentScriptId) {
      // No project yet — open save-as dialog; the pending action will run
      // after save-as completes (via postSaveAction in the store).
      if (pendingAction) setPostSaveAction(pendingAction);
      setPendingAction(null);
      setSaveAsOpen(true);
      return;
    }
    // Existing project — save inline, then run pending action
    await handleSave();
    pendingAction?.();
    setPendingAction(null);
  }, [handleSave, pendingAction, currentProject, currentScriptId, setSaveAsOpen, setPostSaveAction]);

  const handleDiscardConfirmDiscard = useCallback(() => {
    setDiscardConfirmOpen(false);
    pendingAction?.();
    setPendingAction(null);
  }, [pendingAction]);

  const handleDiscardConfirmCancel = useCallback(() => {
    setDiscardConfirmOpen(false);
    setPendingAction(null);
  }, []);

  // ── Page Setup ──
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);

  // ── Per-attribute locking from active template ──
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const editorRule = editor ? getCurrentElementRule(editor, activeTemplate) : null;
  const locked = getLockedFormatting(editorRule, isEnforceMode);

  // ── About / What's New ──
  const [aboutOpen, setAboutOpen] = useState(false);

  // ── Check in (git commit) ──
  const [checkinOpen, setCheckinOpen] = useState(false);
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
    editor.chain().focus().setNode(type).run();
  };

  const handleImport = useCallback(async () => {
    if (!editor) return;
    try {
      const result = await openTextFile([
        { name: 'Screenplay', extensions: ['fountain', 'fdx', 'txt'] },
      ]);
      if (!result) return;

      const { name, content: text } = result;
      const ext = name.split('.').pop()?.toLowerCase();

      // Clear previous document state before importing
      clearTrackChanges();
      const store = useEditorStore.getState();
      store.setBeats([]);
      store.setBeatColumns([]);
      store.setBeatArrangeMode('auto');
      store.setNotes([]);
      store.setTags([]);
      store.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
      store.setCharacterProfiles([]);
      store.setScenes([]);

      let doc;
      if (ext === 'fdx') {
        const parsed = parseFDXFull(text);
        doc = parsed.doc;
        if (parsed.pageLayout) {
          store.setPageLayout({
            ...store.pageLayout,
            ...parsed.pageLayout,
          });
        }
        // Import beats from Outline elements
        if (parsed.beats.length > 0) {
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) {
            store.setBeatColumns(parsed.beatColumns);
          }
        }
        // Import character profiles from CastList + CharacterHighlighting
        if (parsed.castList.length > 0 || parsed.characterHighlighting.length > 0) {
          const highlightMap = new Map(parsed.characterHighlighting.map((h) => [h.name.toUpperCase(), h]));
          for (const member of parsed.castList) {
            const hl = highlightMap.get(member.name.toUpperCase());
            store.upsertCharacterProfile(member.name, {
              description: member.description,
              color: hl?.color || '',
              highlighted: hl?.highlighted || false,
            });
            highlightMap.delete(member.name.toUpperCase());
          }
          // Remaining highlights without cast entries
          for (const [, hl] of highlightMap) {
            store.upsertCharacterProfile(hl.name, { color: hl.color, highlighted: hl.highlighted });
          }
        }
      } else {
        doc = parseFountain(text);
      }
      editor.commands.setContent(doc, true);
      clearEditorHistory(editor);

      // Open as unsaved document — user can save later via Cmd+S
      const scriptTitle = name.replace(/\.\w+$/, '') || 'Untitled';
      store.setDocumentTitle(scriptTitle);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
    } catch (err) {
      console.error('Import failed:', err);
      showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  const handleNewScreenplay = useCallback(() => {
    confirmOrRun(() => {
      if (!editor) return;
      clearTrackChanges();
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'sceneHeading', content: [] }],
      }, true);
      clearEditorHistory(editor);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setScripts([]);
      const store = useEditorStore.getState();
      store.setDocumentTitle('Untitled Screenplay');
      store.setBeats([]);
      store.setBeatColumns([]);
      store.setBeatArrangeMode('auto');
      store.setNotes([]);
      store.setTags([]);
      store.setTagCategories([]);
      store.setCharacterProfiles([]);
      store.setScenes([]);
      store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
    });
  }, [editor, confirmOrRun, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey;
      if (!m) return;
      switch (e.key) {
        case 'n':
          e.preventDefault();
          if (!isCollabGuest) handleNewScreenplay();
          break;
        case 's':
          e.preventDefault();
          if (!isCollabGuest) handleSave();
          break;
        case 'p':
          e.preventDefault();
          window.print();
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
          setZoomLevel(Math.min(200, useEditorStore.getState().zoomLevel + 10));
          break;
        case '-':
          e.preventDefault();
          setZoomLevel(Math.max(50, useEditorStore.getState().zoomLevel - 10));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, handleNewScreenplay, isCollabGuest, setSearchOpen, setGoToPageOpen, setZoomLevel]);

  const handleExportFDX = useCallback(async () => {
    if (!editor) return;
    try {
      const s = useEditorStore.getState();
      await downloadFDX(editor.getJSON(), documentTitle, s.characterProfiles, s.tagCategories, s.tags, s.beats, s.beatColumns, s.pageLayout);
    } catch (err) {
      console.error('FDX export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  const handleExportFountain = useCallback(async () => {
    if (!editor) return;
    try {
      await downloadFountain(editor.getJSON(), documentTitle);
    } catch (err) {
      console.error('Fountain export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  const handleExportPDF = useCallback(async () => {
    if (!editor) return;
    try {
      const store = useEditorStore.getState();
      await exportPDF(editor.getJSON(), documentTitle, pageLayout, {
        sceneNumbersVisible: store.sceneNumbersVisible,
        documentTitle: store.documentTitle,
        revisionColor: store.revisionMode ? store.revisionColor : '',
      });
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout]);

  const handleMenuClick = (label: string) => {
    setActiveMenu((prev) => (prev === label ? null : label));
    setOpenSubmenu(null);
  };

  const handleItemClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.disabled && item.action) {
      item.action();
    }
    setActiveMenu(null);
    setOpenSubmenu(null);
  };

  // Mouse: hover switches submenu (desktop) — no pointerleave to avoid layout shift
  const handleSubmenuPointerEnter = (label: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(label);
  };
  const handleItemPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(null);
  };
  // Touch: tap toggles submenu (mobile)
  const handleSubmenuTouchEnd = (label: string, e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenSubmenu((prev) => (prev === label ? null : label));
  };

  const menus: MenuSection[] = [
    {
      label: 'File',
      items: [
        {
          icon: <FaPlus />,
          label: 'New Screenplay',
          shortcut: `${mod}N`,
          disabled: isCollabGuest,
          action: handleNewScreenplay,
        },
        ...(isDesktopTauri() ? [{
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
        { icon: <FaFileImport />, label: 'Import...', action: () => confirmOrRun(handleImport), disabled: isCollabGuest },
        { icon: <FaFolderOpen />, label: 'Open from Project...', action: () => confirmOrRun(() => setOpenFromProjectOpen(true)), disabled: isCollabGuest },
        { icon: <FaSave />, label: 'Save', shortcut: `${mod}S`, action: handleSave, disabled: isCollabGuest },
        { separator: true, label: '' },
        {
          icon: <FaFileExport />, label: 'Export',
          children: [
            { icon: <FaFileCode />, label: 'Final Draft (.fdx)', action: handleExportFDX, disabled: isCollabGuest },
            { icon: <FaFileAlt />, label: 'Fountain (.fountain)', action: handleExportFountain, disabled: isCollabGuest },
            { icon: <FaFilePdf />, label: 'PDF', action: handleExportPDF },
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaCodeBranch />, label: 'Versions',
          disabled: isCollabGuest,
          children: [
            { icon: <FaUpload />, label: 'Check In...', action: handleCheckinOpen, disabled: isCollabGuest },
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
        { separator: true, label: '' },
        { icon: <FaCog />, label: 'Page Setup...', action: () => setPageSetupOpen(true) },
        { icon: <FaPrint />, label: 'Print...', shortcut: `${mod}P`, action: () => window.print() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { icon: <FaUndo />, label: 'Undo', shortcut: `${mod}Z`, action: () => { try { editor?.chain().focus().undo().run(); } catch {} } },
        { icon: <FaRedo />, label: 'Redo', shortcut: `⇧${mod}Z`, action: () => { try { editor?.chain().focus().redo().run(); } catch {} } },
        { separator: true, label: '' },
        { icon: <FaCut />, label: 'Cut', shortcut: `${mod}X`, action: () => document.execCommand('cut') },
        { icon: <FaCopy />, label: 'Copy', shortcut: `${mod}C`, action: () => document.execCommand('copy') },
        { icon: <FaPaste />, label: 'Paste', shortcut: `${mod}V`, action: () => document.execCommand('paste') },
        { icon: <FaMousePointer />, label: 'Select All', shortcut: `${mod}A`, action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        { icon: <FaSearch />, label: 'Find & Replace...', shortcut: `${mod}F`, action: () => setSearchOpen(true) },
        { icon: <FaHashtag />, label: 'Go to Page...', shortcut: `${mod}G`, action: () => setGoToPageOpen(true) },
        { icon: <FaSpellCheck />, label: spellCheckEnabled ? '\u2713 Spell Check' : 'Spell Check', action: toggleSpellCheck },
      ],
    },
    {
      label: 'Format',
      items: [
        {
          icon: <FaListOl />, label: 'Element',
          children: [
            ...Object.values(activeTemplate.rules).filter((r) => r.enabled).map((r) => {
              const shortcuts: Record<string, string> = {
                sceneHeading: `${mod}1`, action: `${mod}2`, character: `${mod}3`, dialogue: `${mod}4`,
                parenthetical: `${mod}5`, transition: `${mod}6`, general: `${mod}7`, shot: `${mod}8`,
              };
              return { label: r.label, shortcut: shortcuts[r.id], action: () => setElement(r.id as any) };
            }),
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaBold />, label: 'Style',
          children: [
            { icon: <FaBold />, label: 'Bold', shortcut: `${mod}B`, action: () => editor?.chain().focus().toggleBold().run(), disabled: locked.bold },
            { icon: <FaItalic />, label: 'Italic', shortcut: `${mod}I`, action: () => editor?.chain().focus().toggleItalic().run(), disabled: locked.italic },
            { icon: <FaUnderline />, label: 'Underline', shortcut: `${mod}U`, action: () => editor?.chain().focus().toggleUnderline().run(), disabled: locked.underline },
            { icon: <FaStrikethrough />, label: 'Strikethrough', action: () => editor?.chain().focus().toggleStrike().run(), disabled: locked.strikethrough },
            { separator: true, label: '' },
            { icon: <FaSubscript />, label: 'Subscript', action: () => editor?.chain().focus().toggleSubscript().run(), disabled: locked.subscript },
            { icon: <FaSuperscript />, label: 'Superscript', action: () => editor?.chain().focus().toggleSuperscript().run(), disabled: locked.superscript },
          ],
        },
        {
          icon: <FaAlignLeft />, label: 'Alignment',
          children: [
            { icon: <FaAlignLeft />, label: 'Align Left', action: () => editor?.chain().focus().setTextAlign('left').run(), disabled: locked.textAlign },
            { icon: <FaAlignCenter />, label: 'Align Center', action: () => editor?.chain().focus().setTextAlign('center').run(), disabled: locked.textAlign },
            { icon: <FaAlignRight />, label: 'Align Right', action: () => editor?.chain().focus().setTextAlign('right').run(), disabled: locked.textAlign },
            { icon: <FaAlignJustify />, label: 'Justify', action: () => editor?.chain().focus().setTextAlign('justify').run(), disabled: locked.textAlign },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaColumns />, label: 'Dual Dialogue', shortcut: `${mod}D`, action: () => (editor as any)?.commands?.toggleDualDialogue() },
        { separator: true, label: '' },
        { icon: <FaFileAlt />, label: `Formatting Template (${activeTemplate.name})...`, action: () => setTemplateSelectOpen(true) },
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
          icon: <FaAdjust />,
          label: theme === 'light' ? '\u2713 Light Theme' : 'Light Theme',
          action: () => setTheme(theme === 'light' ? 'dark' : 'light'),
        },
        { separator: true, label: '' },
        {
          icon: <FaToolbox />, label: 'Menu & Toolbar',
          children: [
            { icon: <FaCompressArrowsAlt />, label: toolbarMode === 'compact' ? '\u2713 Compact' : 'Compact', action: () => setToolbarMode('compact') },
            { icon: <FaExpandArrowsAlt />, label: toolbarMode === 'comfortable' ? '\u2713 Comfortable' : 'Comfortable', action: () => setToolbarMode('comfortable') },
            { icon: <FaEyeSlash />, label: toolbarMode === 'hidden' ? '\u2713 Hidden' : 'Hidden', action: () => {
              setToolbarMode('hidden');
              if (localStorage.getItem('opendraft:hiddenModeIntroShown') !== '1') {
                setShowHiddenModeIntro(true);
              }
            }},
          ],
        },
        {
          icon: <FaSearchPlus />, label: `Zoom (${zoomLevel}%)`,
          children: [
            { icon: <FaSearchPlus />, label: 'Zoom In', shortcut: `${mod}+`, action: () => setZoomLevel(Math.min(200, zoomLevel + 10)) },
            { icon: <FaSearchMinus />, label: 'Zoom Out', shortcut: `${mod}−`, action: () => setZoomLevel(Math.max(50, zoomLevel - 10)) },
            { separator: true, label: '' },
            { label: zoomLevel === 50 ? '\u2713 50%' : '50%', action: () => setZoomLevel(50) },
            { label: zoomLevel === 75 ? '\u2713 75%' : '75%', action: () => setZoomLevel(75) },
            { label: zoomLevel === 100 ? '\u2713 100%' : '100%', action: () => setZoomLevel(100) },
            { label: zoomLevel === 125 ? '\u2713 125%' : '125%', action: () => setZoomLevel(125) },
            { label: zoomLevel === 150 ? '\u2713 150%' : '150%', action: () => setZoomLevel(150) },
            { label: zoomLevel === 200 ? '\u2713 200%' : '200%', action: () => setZoomLevel(200) },
          ],
        },
      ],
    },
    {
      label: 'Tools',
      items: [
        { icon: <FaUserFriends />, label: isCollabActive ? '\u2713 Collaborate...' : 'Collaborate...', action: onCollaborate, disabled: isCollabGuest },
        { icon: <FaSignInAlt />, label: 'Join Collaboration...', action: onJoinCollab, disabled: isCollabGuest },
        { separator: true, label: '' },
        { icon: <FaProjectDiagram />, label: 'Manage Projects...', action: () => { window.location.href = '/projects'; }, disabled: isCollabGuest },
        { icon: <FaBoxes />, label: 'Asset Manager', action: () => useAssetStore.getState().toggleAssetManager() },
        { icon: <FaCog />, label: 'System Settings...', action: () => { window.location.href = '/settings'; } },
        { separator: true, label: '' },
        {
          icon: <FaFilm />, label: 'Production',
          children: [
            { icon: <FaToggleOn />, label: revisionMode ? '\u2713 Revision Mode' : 'Revision Mode', action: () => setRevisionMode(!revisionMode) },
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
              disabled: !sceneNumbersVisible,
            },
            { separator: true, label: '' },
            { icon: <FaLock />, label: 'Lock Pages', disabled: true },
          ],
        },
      ],
    },
  ];

  // Help menu rendered separately as a 3-dot overflow on the right
  const helpMenu: MenuSection = {
    label: 'Help',
    items: [
      {
        icon: <FaInfoCircle />,
        label: 'About Open Draft',
        action: () => setAboutOpen(true),
      },
      {
        icon: <FaKeyboard />,
        label: 'Keyboard Shortcuts',
        action: () =>
          showToast(`${mod}1-8: Elements | Tab: Next | ${mod}B/I/U: Format | ${mod}Z: Undo | ${mod}F: Find | ${mod}G: Go to Page`, 'success'),
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
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!activeMenu) return;
    const el = menuItemRefs.current[activeMenu];
    if (el) {
      const rect = el.getBoundingClientRect();
      const dropdownWidth = 260; // min-width of .menu-dropdown
      const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);

      // In floating mode, position relative to the panel edges (not individual items)
      // so the dropdown clears the rounded, padded floating menu panel.
      if (toolbarMode === 'hidden' && menuRef.current) {
        const panelRect = menuRef.current.getBoundingClientRect();
        if (panelRect.bottom > window.innerHeight * 0.55) {
          setDropdownPos({ bottom: window.innerHeight - panelRect.top + 4, left, top: undefined });
        } else {
          setDropdownPos({ top: panelRect.bottom + 4, left, bottom: undefined });
        }
      } else {
        setDropdownPos({ top: rect.bottom, left, bottom: undefined });
      }
    }
  }, [activeMenu, toolbarMode]);

  // Floating menu toggle (hidden mode)
  const [floatingMenuOpen, setFloatingMenuOpen] = useState(false);
  const [showHiddenModeIntro, setShowHiddenModeIntro] = useState(false);
  const [hiddenModeDontShow, setHiddenModeDontShow] = useState(true);

  // Draggable FAB position — persisted to localStorage
  const FAB_POS_KEY = 'opendraft:fabPosition';
  const FAB_SIZE = 36;
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const s = localStorage.getItem('opendraft:fabPosition');
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
          onClick={() => handleMenuClick(menu.label)}
          onMouseEnter={() => {
            if (activeMenu) setActiveMenu(menu.label);
          }}
        >
          {menuIcons[menu.label] && <span className="menu-icon">{menuIcons[menu.label]}</span>}
          <span className="menu-label">{menu.label}</span>
        </div>
      ))}
      <div className="menu-spacer" />
      <div
        ref={(el) => { menuItemRefs.current['Help'] = el; }}
        className={`menu-item menu-item--more ${activeMenu === 'Help' ? 'active' : ''}`}
        onClick={() => handleMenuClick('Help')}
        onMouseEnter={() => {
          if (activeMenu) setActiveMenu('Help');
        }}
        title="Help & About"
      >
        <FaEllipsisH />
      </div>
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
            style={{ left: fabX, top: fabY }}
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
        style={{ top: dropdownPos.top, bottom: dropdownPos.bottom, left: dropdownPos.left }}
      >
        {activeMenuData.items.map((item, i) =>
          item.separator ? (
            <div key={i} className="menu-separator" onPointerEnter={handleItemPointerEnter} />
          ) : item.children ? (
            <div
              key={item.label}
              className={`menu-dropdown-item has-children ${openSubmenu === item.label ? 'submenu-open' : ''}`}
              onPointerEnter={(e) => handleSubmenuPointerEnter(item.label!, e)}
              onTouchEnd={(e) => handleSubmenuTouchEnd(item.label!, e)}
              onClick={(e) => { e.stopPropagation(); setOpenSubmenu((prev) => (prev === item.label ? null : item.label!)); }}
            >
              {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
              <span>{item.label}</span>
              <span className="menu-submenu-arrow">{openSubmenu === item.label ? '\u25BE' : '\u25B8'}</span>
              <div
                className={`menu-submenu ${openSubmenu === item.label ? 'submenu-visible' : ''}`}
                ref={(el) => {
                  if (el && openSubmenu === item.label) {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                      el.classList.add('submenu-flip');
                    } else {
                      el.classList.remove('submenu-flip');
                    }
                    if (rect.bottom > window.innerHeight) {
                      el.classList.add('submenu-flip-y');
                    } else {
                      el.classList.remove('submenu-flip-y');
                    }
                  }
                }}
              >
                {item.children.map((child, j) =>
                  child.separator ? (
                    <div key={j} className="menu-separator" />
                  ) : (
                    <div
                      key={child.label}
                      className={`menu-dropdown-item ${child.disabled ? 'disabled' : ''}`}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onClick={(e) => handleItemClick(child, e)}
                    >
                      {child.icon && <span className="menu-dropdown-icon">{child.icon}</span>}
                      <span>{child.label}</span>
                      {child.shortcut && (
                        <span className="menu-shortcut">{child.shortcut}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div
              key={item.label}
              className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
              onPointerEnter={handleItemPointerEnter}
              onClick={(e) => handleItemClick(item, e)}
            >
              {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
              <span>{item.label}</span>
              {item.shortcut && (
                <span className="menu-shortcut">{item.shortcut}</span>
              )}
            </div>
          )
        )}
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
              if (hiddenModeDontShow) localStorage.setItem('opendraft:hiddenModeIntroShown', '1');
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
    {aboutOpen && (
      <div className="dialog-overlay" onClick={() => setAboutOpen(false)}>
        <div className="dialog-box about-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">About Open Draft</div>
          <div className="dialog-body about-body">
            <div className="about-title">Open Draft</div>
            <div className="about-version">Version 0.16.1</div>
            <div className="about-tagline">Free, open-source screenwriting software</div>

            <div className="about-whats-new">
              <div className="about-section-title">What's New in 0.16.1</div>
              <ul className="about-list">
                <li><strong>Multiple Windows</strong> — Open different files in separate windows via File &gt; New Window. Each window has independent editor state.</li>
                <li><strong>Save Status Indicator</strong> — The status bar now shows Unsaved changes, Saving, Saved, or Save failed in real time.</li>
                <li><strong>Save Failure Recovery</strong> — A persistent banner with Retry, Save As, and Export Backup actions appears when auto-save fails.</li>
                <li><strong>Collaboration Status</strong> — The collab banner shows connection state (Connecting, Synced, Reconnecting) and an activity log tracking joins, leaves, and sync events.</li>
                <li><strong>File Drag-and-Drop Fix</strong> — Dragging .fdx, .fountain, .odraft, or .txt files from the OS into the editor now works on desktop.</li>
                <li><strong>Open With in New Window</strong> — Double-clicking a screenplay file while the app is running opens it in a new window without disturbing your current work.</li>
              </ul>
            </div>

            <div className="about-whats-new">
              <div className="about-section-title">Compatibility</div>
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
                    <tr key={entry.label}>
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="dialog-actions">
            <button className="dialog-primary" onClick={() => setAboutOpen(false)}>Close</button>
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
    </>
  );
};

export default MenuBar;
