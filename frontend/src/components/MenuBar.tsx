import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
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
import { pluginRegistry } from '../plugins/registry';
import type { MenuSection as PluginMenuSection } from '../plugins/registry';

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
    setSaveAsOpen,
    theme,
    setTheme,
    trackChangesEnabled,
    setTrackChangesEnabled,
    setTrackChangesLabel,
    setCompareVersionOpen,
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
      _tags: store.tags,
      _tagCategories: store.tagCategories,
      _characterProfiles: store.characterProfiles,
      _beats: store.beats,
      _beatColumns: store.beatColumns,
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

  // ── Page Setup ──
  const [pageSetupOpen, setPageSetupOpen] = useState(false);

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
    const { openTextFile } = await import('../utils/fileOps');
    const result = await openTextFile([
      { name: 'Screenplay', extensions: ['fountain', 'fdx', 'txt'] },
    ]);
    if (!result) return;

    const { name, content: text } = result;
    const ext = name.split('.').pop()?.toLowerCase();
    let doc;
    if (ext === 'fdx') {
      const parsed = parseFDXFull(text);
      doc = parsed.doc;
      if (parsed.pageLayout) {
        useEditorStore.getState().setPageLayout({
          pageWidth: parsed.pageLayout.pageWidth,
          pageHeight: parsed.pageLayout.pageHeight,
          topMargin: parsed.pageLayout.topMargin,
          bottomMargin: parsed.pageLayout.bottomMargin,
          headerMargin: parsed.pageLayout.headerMargin,
          footerMargin: parsed.pageLayout.footerMargin,
          leftMargin: parsed.pageLayout.leftMargin,
          rightMargin: parsed.pageLayout.rightMargin,
        });
      }
      // Import beats from Outline elements
      if (parsed.beats.length > 0) {
        const store = useEditorStore.getState();
        store.setBeats(parsed.beats);
        if (parsed.beatColumns.length > 0) {
          store.setBeatColumns(parsed.beatColumns);
        }
      }
      // Import character profiles from CastList + CharacterHighlighting
      if (parsed.castList.length > 0 || parsed.characterHighlighting.length > 0) {
        const store = useEditorStore.getState();
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
          store.upsertCharacterProfile(hl.name, {
            color: hl.color,
            highlighted: hl.highlighted,
          });
        }
      }
    } else {
      doc = parseFountain(text);
    }
    editor.commands.setContent(doc);

    // Create project + script in backend via Save As dialog
    const scriptTitle = name.replace(/\.\w+$/, '') || 'Untitled';
    useEditorStore.getState().setDocumentTitle(scriptTitle);
    setSaveAsOpen(true);
  }, [editor, setCurrentProject, setCurrentScriptId, setScripts, setSaveAsOpen]);

  const handleExportFDX = useCallback(async () => {
    if (!editor) return;
    const s = useEditorStore.getState();
    await downloadFDX(editor.getJSON(), documentTitle, s.characterProfiles, s.tagCategories, s.tags, s.beats, s.beatColumns);
  }, [editor, documentTitle]);

  const handleExportFountain = useCallback(async () => {
    if (!editor) return;
    await downloadFountain(editor.getJSON(), documentTitle);
  }, [editor, documentTitle]);

  const handleExportPDF = useCallback(async () => {
    if (!editor) return;
    await exportPDF(editor.getJSON(), documentTitle, pageLayout);
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
            if (!editor) return;
            clearTrackChanges();
            editor.commands.setContent({
              type: 'doc',
              content: [{ type: 'sceneHeading', content: [] }],
            });
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
          },
        },
        { separator: true, label: '' },
        { label: 'Import...', action: handleImport, disabled: isCollabGuest },
        { label: 'Open from Project...', action: () => setOpenFromProjectOpen(true), disabled: isCollabGuest },
        { label: 'Save', shortcut: '\u2318S', action: handleSave, disabled: isCollabGuest },
        { separator: true, label: '' },
        {
          label: 'Export',
          children: [
            { label: 'Final Draft (.fdx)', action: handleExportFDX, disabled: isCollabGuest },
            { label: 'Fountain (.fountain)', action: handleExportFountain, disabled: isCollabGuest },
            { label: 'PDF', action: handleExportPDF },
          ],
        },
        { separator: true, label: '' },
        {
          label: 'Versions',
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
        { label: 'Page Setup...', action: () => setPageSetupOpen(true) },
        { label: 'Print...', shortcut: '\u2318P', action: () => window.print() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', action: () => { try { editor?.chain().focus().undo().run(); } catch {} } },
        { label: 'Redo', shortcut: '⇧⌘Z', action: () => { try { editor?.chain().focus().redo().run(); } catch {} } },
        { separator: true, label: '' },
        { label: 'Cut', shortcut: '⌘X', action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: '⌘C', action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: '⌘V', action: () => document.execCommand('paste') },
        { label: 'Select All', shortcut: '⌘A', action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        { label: 'Find & Replace...', shortcut: '⌘F', action: () => setSearchOpen(true) },
        { label: 'Go to Page...', shortcut: '⌘G', action: () => setGoToPageOpen(true) },
        { label: spellCheckEnabled ? '\u2713 Spell Check' : 'Spell Check', action: toggleSpellCheck },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Scene Heading', shortcut: '⌘1', action: () => setElement('sceneHeading') },
        { label: 'Action', shortcut: '⌘2', action: () => setElement('action') },
        { label: 'Character', shortcut: '⌘3', action: () => setElement('character') },
        { label: 'Dialogue', shortcut: '⌘4', action: () => setElement('dialogue') },
        { label: 'Parenthetical', shortcut: '⌘5', action: () => setElement('parenthetical') },
        { label: 'Transition', shortcut: '⌘6', action: () => setElement('transition') },
        { label: 'General', shortcut: '⌘7', action: () => setElement('general') },
        { label: 'Shot', shortcut: '⌘8', action: () => setElement('shot') },
        { separator: true, label: '' },
        { label: 'New Act', action: () => setElement('newAct') },
        { label: 'End of Act', action: () => setElement('endOfAct') },
        { label: 'Lyrics', action: () => setElement('lyrics') },
        { label: 'Show/Episode', action: () => setElement('showEpisode') },
        { label: 'Cast List', action: () => setElement('castList') },
        { separator: true, label: '' },
        { label: 'Bold', shortcut: '⌘B', action: () => editor?.chain().focus().toggleBold().run() },
        { label: 'Italic', shortcut: '⌘I', action: () => editor?.chain().focus().toggleItalic().run() },
        { label: 'Underline', shortcut: '⌘U', action: () => editor?.chain().focus().toggleUnderline().run() },
      ],
    },
    {
      label: 'View',
      items: [
        { label: navigatorOpen ? '\u2713 Navigator' : 'Navigator', action: toggleNavigator },
        { label: indexCardsOpen ? '\u2713 Index Cards' : 'Index Cards', action: toggleIndexCards },
        { label: beatBoardOpen ? '\u2713 Beat Board' : 'Beat Board', action: toggleBeatBoard },
        { label: scriptNotesOpen ? '\u2713 Script Notes' : 'Script Notes', action: toggleScriptNotes },
        { label: characterProfilesOpen ? '\u2713 Characters' : 'Characters', action: toggleCharacterProfiles },
        { label: tagsPanelOpen ? '\u2713 Tags' : 'Tags', action: toggleTagsPanel },
        { separator: true, label: '' },
        { label: notesVisible ? '\u2713 Note Highlights' : 'Note Highlights', action: () => setNotesVisible(!notesVisible) },
        { label: tagsVisible ? '\u2713 Tag Highlights' : 'Tag Highlights', action: () => setTagsVisible(!tagsVisible) },
        { separator: true, label: '' },
        {
          label: theme === 'light' ? '\u2713 Light Theme' : 'Light Theme',
          action: () => setTheme(theme === 'light' ? 'dark' : 'light'),
        },
      ],
    },
    {
      label: 'Production',
      items: [
        { label: revisionMode ? '\u2713 Revision Mode' : 'Revision Mode', action: () => setRevisionMode(!revisionMode) },
        { label: 'Scene Numbers...', disabled: true },
        { label: 'Lock Pages', disabled: true },
        { separator: true, label: '' },
        { label: 'Asset Manager', action: () => useAssetStore.getState().toggleAssetManager() },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: isCollabActive ? '\u2713 Collaborate...' : 'Collaborate...', action: onCollaborate, disabled: isCollabGuest },
        { label: 'Join Collaboration...', action: onJoinCollab, disabled: isCollabGuest },
        { separator: true, label: '' },
        { label: 'Manage Projects...', action: () => { window.location.href = '/projects'; }, disabled: isCollabGuest },
        { label: 'System Settings...', action: () => { window.location.href = '/settings'; } },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'About Open Draft',
          action: () => setAboutOpen(true),
        },
        {
          label: 'Keyboard Shortcuts',
          action: () =>
            showToast('⌘1-8: Elements | Tab: Next | ⌘B/I/U: Format | ⌘Z: Undo | ⌘F: Find | ⌘G: Go to Page', 'success'),
        },
      ],
    },
  ];

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
      setDropdownPos({ top: rect.bottom, left: rect.left });
    }
  }, [activeMenu]);

  // Find the active menu's items
  const activeMenuData = activeMenu ? menus.find(m => m.label === activeMenu) : null;

  return (
    <>
    <div className="menu-bar" ref={menuRef}>
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
          <span className="menu-label">{menu.label}</span>
        </div>
      ))}
    </div>
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
              <span>{item.label}</span>
              <span className="menu-submenu-arrow">{openSubmenu === item.label ? '\u25BE' : '\u25B8'}</span>
              <div className={`menu-submenu ${openSubmenu === item.label ? 'submenu-visible' : ''}`}>
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
    {aboutOpen && (
      <div className="dialog-overlay" onClick={() => setAboutOpen(false)}>
        <div className="dialog-box about-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">About Open Draft</div>
          <div className="dialog-body about-body">
            <div className="about-title">Open Draft</div>
            <div className="about-version">Version 0.7.0</div>
            <div className="about-tagline">Free, open-source screenwriting software</div>

            <div className="about-whats-new">
              <div className="about-section-title">What's New in 0.7.0</div>
              <ul className="about-list">
                <li><strong>Local SQLite Storage</strong> — Desktop app now uses local SQLite instead of a Python sidecar, making it faster and eliminating DLL compatibility issues.</li>
                <li><strong>Remote Collaboration Server</strong> — Real-time collaboration moved to a dedicated server with JWT auth, Google OAuth, and TLS support.</li>
                <li><strong>Beat Board Improvements</strong> — Inline drag handles, column maximize, URL link previews, smoother drag-and-drop, and mobile/touch support.</li>
                <li><strong>General Notes</strong> — New General Notes tab in the Notes panel for free-form project notes.</li>
                <li><strong>iOS Mobile Fixes</strong> — Fixed status bar overlap, bottom padding, and removed mobile accessory bar for a cleaner experience.</li>
              </ul>
            </div>
          </div>
          <div className="dialog-actions">
            <button className="dialog-primary" onClick={() => setAboutOpen(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default MenuBar;
