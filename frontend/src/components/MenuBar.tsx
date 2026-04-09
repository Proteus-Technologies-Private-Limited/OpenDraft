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
import type { MenuSection as PluginMenuSection } from '../plugins/registry';
import {
  FaFile,
  FaPencilAlt,
  FaPalette,
  FaEye,
  FaWrench,
  FaEllipsisH,
  FaFileImport,
  FaFolderOpen,
  FaSave,
  FaFileExport,
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
  FaAlignLeft,
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

  // ── Keyboard shortcut: Cmd+S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!isCollabGuest) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, isCollabGuest]);

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
          label: 'New Screenplay',
          shortcut: '⌘N',
          disabled: isCollabGuest,
          action: () => {
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
              // Navigate to root so URL doesn't trigger stale project loading
              if (window.location.pathname !== '/') {
                window.history.replaceState(null, '', '/');
              }
            });
          },
        },
        { separator: true, label: '' },
        { icon: <FaFileImport />, label: 'Import...', action: () => confirmOrRun(handleImport), disabled: isCollabGuest },
        { icon: <FaFolderOpen />, label: 'Open from Project...', action: () => confirmOrRun(() => setOpenFromProjectOpen(true)), disabled: isCollabGuest },
        { icon: <FaSave />, label: 'Save', shortcut: '\u2318S', action: handleSave, disabled: isCollabGuest },
        { separator: true, label: '' },
        {
          icon: <FaFileExport />, label: 'Export',
          children: [
            { label: 'Final Draft (.fdx)', action: handleExportFDX, disabled: isCollabGuest },
            { label: 'Fountain (.fountain)', action: handleExportFountain, disabled: isCollabGuest },
            { label: 'PDF', action: handleExportPDF },
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaCodeBranch />, label: 'Versions',
          disabled: isCollabGuest,
          children: [
            { label: 'Check In...', action: handleCheckinOpen, disabled: isCollabGuest },
            { label: 'Version History', action: () => setVersionHistoryOpen(true), disabled: isCollabGuest },
            { separator: true, label: '' },
            {
              label: trackChangesEnabled
                ? '\u2713 Track Changes'
                : 'Track Changes Since Last Check-In',
              action: handleTrackChangesToggle,
            },
            { label: 'Compare with Version\u2026', action: () => setCompareVersionOpen(true) },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaCog />, label: 'Page Setup...', action: () => setPageSetupOpen(true) },
        { icon: <FaPrint />, label: 'Print...', shortcut: '\u2318P', action: () => window.print() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { icon: <FaUndo />, label: 'Undo', shortcut: '⌘Z', action: () => { try { editor?.chain().focus().undo().run(); } catch {} } },
        { icon: <FaRedo />, label: 'Redo', shortcut: '⇧⌘Z', action: () => { try { editor?.chain().focus().redo().run(); } catch {} } },
        { separator: true, label: '' },
        { icon: <FaCut />, label: 'Cut', shortcut: '⌘X', action: () => document.execCommand('cut') },
        { icon: <FaCopy />, label: 'Copy', shortcut: '⌘C', action: () => document.execCommand('copy') },
        { icon: <FaPaste />, label: 'Paste', shortcut: '⌘V', action: () => document.execCommand('paste') },
        { icon: <FaMousePointer />, label: 'Select All', shortcut: '⌘A', action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        { icon: <FaSearch />, label: 'Find & Replace...', shortcut: '⌘F', action: () => setSearchOpen(true) },
        { icon: <FaHashtag />, label: 'Go to Page...', shortcut: '⌘G', action: () => setGoToPageOpen(true) },
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
                sceneHeading: '⌘1', action: '⌘2', character: '⌘3', dialogue: '⌘4',
                parenthetical: '⌘5', transition: '⌘6', general: '⌘7', shot: '⌘8',
              };
              return { label: r.label, shortcut: shortcuts[r.id], action: () => setElement(r.id as any) };
            }),
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaBold />, label: 'Style',
          children: [
            { label: 'Bold', shortcut: '⌘B', action: () => editor?.chain().focus().toggleBold().run(), disabled: locked.bold },
            { label: 'Italic', shortcut: '⌘I', action: () => editor?.chain().focus().toggleItalic().run(), disabled: locked.italic },
            { label: 'Underline', shortcut: '⌘U', action: () => editor?.chain().focus().toggleUnderline().run(), disabled: locked.underline },
            { label: 'Strikethrough', action: () => editor?.chain().focus().toggleStrike().run(), disabled: locked.strikethrough },
            { separator: true, label: '' },
            { label: 'Subscript', action: () => editor?.chain().focus().toggleSubscript().run(), disabled: locked.subscript },
            { label: 'Superscript', action: () => editor?.chain().focus().toggleSuperscript().run(), disabled: locked.superscript },
          ],
        },
        {
          icon: <FaAlignLeft />, label: 'Alignment',
          children: [
            { label: 'Align Left', action: () => editor?.chain().focus().setTextAlign('left').run(), disabled: locked.textAlign },
            { label: 'Align Center', action: () => editor?.chain().focus().setTextAlign('center').run(), disabled: locked.textAlign },
            { label: 'Align Right', action: () => editor?.chain().focus().setTextAlign('right').run(), disabled: locked.textAlign },
            { label: 'Justify', action: () => editor?.chain().focus().setTextAlign('justify').run(), disabled: locked.textAlign },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaColumns />, label: 'Dual Dialogue', shortcut: '⌘D', action: () => (editor as any)?.commands?.toggleDualDialogue() },
        { separator: true, label: '' },
        { icon: <FaFileAlt />, label: `Formatting Template (${activeTemplate.name})...`, action: () => setTemplateSelectOpen(true) },
      ],
    },
    {
      label: 'View',
      items: [
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
        { separator: true, label: '' },
        { icon: <FaHighlighter />, label: notesVisible ? '\u2713 Note Highlights' : 'Note Highlights', action: () => setNotesVisible(!notesVisible) },
        { icon: <FaHighlighter />, label: tagsVisible ? '\u2713 Tag Highlights' : 'Tag Highlights', action: () => setTagsVisible(!tagsVisible) },
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
            { label: toolbarMode === 'compact' ? '\u2713 Compact' : 'Compact', action: () => setToolbarMode('compact') },
            { label: toolbarMode === 'comfortable' ? '\u2713 Comfortable' : 'Comfortable', action: () => setToolbarMode('comfortable') },
            { label: toolbarMode === 'hidden' ? '\u2713 Hidden' : 'Hidden', action: () => setToolbarMode('hidden') },
          ],
        },
        {
          icon: <FaSearchPlus />, label: `Zoom (${zoomLevel}%)`,
          children: [
            { icon: <FaSearchPlus />, label: 'Zoom In', shortcut: '⌘+', action: () => setZoomLevel(Math.min(200, zoomLevel + 10)) },
            { icon: <FaSearchMinus />, label: 'Zoom Out', shortcut: '⌘−', action: () => setZoomLevel(Math.max(50, zoomLevel - 10)) },
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
            { label: revisionMode ? '\u2713 Revision Mode' : 'Revision Mode', action: () => setRevisionMode(!revisionMode) },
            { separator: true, label: '' },
            {
              label: sceneNumbersVisible ? '\u2713 Show Scene Numbers' : 'Show Scene Numbers',
              action: () => setSceneNumbersVisible(!sceneNumbersVisible),
            },
            {
              label: sceneNumbersLocked ? '\u2713 Lock Scene Numbers' : 'Lock Scene Numbers',
              action: () => setSceneNumbersLocked(!sceneNumbersLocked),
              disabled: !sceneNumbersVisible,
            },
            { separator: true, label: '' },
            { label: 'Lock Pages', disabled: true },
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
          showToast('⌘1-8: Elements | Tab: Next | ⌘B/I/U: Format | ⌘Z: Undo | ⌘F: Find | ⌘G: Go to Page', 'success'),
      },
    ],
  };

  // Append plugin menu items to each section
  const pluginCtx = { editor };
  for (const menu of menus) {
    const pluginItems = pluginRegistry.getMenuItems(menu.label as PluginMenuSection);
    if (pluginItems.length > 0) {
      menu.items.push({ separator: true, label: '' });
      for (const p of pluginItems) {
        menu.items.push({
          label: p.label,
          shortcut: p.shortcut,
          action: () => p.action(pluginCtx),
          disabled: typeof p.disabled === 'function' ? p.disabled(pluginCtx) : p.disabled,
        });
      }
    }
  }

  // Track the active menu item's position for the portal dropdown
  const menuItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!activeMenu) return;
    const el = menuItemRefs.current[activeMenu];
    if (el) {
      const rect = el.getBoundingClientRect();
      const dropdownWidth = 260; // min-width of .menu-dropdown
      const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);
      setDropdownPos({ top: rect.bottom, left });
    }
  }, [activeMenu]);

  // Floating menu toggle (hidden mode)
  const [floatingMenuOpen, setFloatingMenuOpen] = useState(false);

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

  // Close floating menu when clicking outside
  useEffect(() => {
    if (!floatingMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
            className={`menu-fab ${floatingMenuOpen ? 'menu-fab--open' : ''}`}
            style={{ left: navPanelWidth + 14 }}
            onClick={() => setFloatingMenuOpen(!floatingMenuOpen)}
            title="Menu"
          >
            <FaBars />
          </div>
          {floatingMenuOpen && (
            <div className="menu-bar chrome-comfortable menu-bar--floating" style={{ left: navPanelWidth + 14 }} ref={menuRef}>
              {renderMenuItems()}
            </div>
          )}
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
        className="menu-dropdown"
        style={{ top: dropdownPos.top, left: dropdownPos.left }}
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
            <div className="about-version">Version 0.14.1</div>
            <div className="about-tagline">Free, open-source screenwriting software</div>

            <div className="about-whats-new">
              <div className="about-section-title">What's New in 0.14.1</div>
              <ul className="about-list">
                <li><strong>Mobile Export &amp; Import</strong> — Export (FDX, Fountain, PDF) and import now work reliably on both iOS and Android using native share sheets and file pickers.</li>
                <li><strong>iOS File Associations</strong> — Open .fdx, .fountain, and .odraft files directly from the iOS Files app or any app via "Open With". Security-scoped file access is handled automatically.</li>
                <li><strong>Error Notifications</strong> — Export and import operations now show clear error messages via toast notifications instead of failing silently.</li>
                <li><strong>Android Share Intent</strong> — Android exports use the native share chooser, letting you save to Files, Drive, or share via any installed app.</li>
              </ul>
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
