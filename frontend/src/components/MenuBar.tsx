import React, { useState, useRef, useEffect, useCallback } from 'react';
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

interface MenuBarProps {
  editor: Editor | null;
  onCollaborate?: () => void;
  isCollabActive?: boolean;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const MenuBar: React.FC<MenuBarProps> = ({ editor, onCollaborate, isCollabActive }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    toggleNavigator,
    toggleIndexCards,
    toggleBeatBoard,
    toggleScriptNotes,
    toggleCharacterProfiles,
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
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const setElement = (type: string) => {
    if (!editor) return;
    editor.chain().focus().setNode(type).run();
  };

  const handleImport = useCallback(() => {
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.fdx,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const text = reader.result as string;
        const ext = file.name.split('.').pop()?.toLowerCase();
        let doc;
        if (ext === 'fdx') {
          const result = parseFDXFull(text);
          doc = result.doc;
          if (result.pageLayout) {
            useEditorStore.getState().setPageLayout({
              pageWidth: result.pageLayout.pageWidth,
              pageHeight: result.pageLayout.pageHeight,
              topMargin: result.pageLayout.topMargin,
              bottomMargin: result.pageLayout.bottomMargin,
              headerMargin: result.pageLayout.headerMargin,
              footerMargin: result.pageLayout.footerMargin,
              leftMargin: result.pageLayout.leftMargin,
              rightMargin: result.pageLayout.rightMargin,
            });
          }
          // Import character profiles from CastList + CharacterHighlighting
          if (result.castList.length > 0 || result.characterHighlighting.length > 0) {
            const store = useEditorStore.getState();
            const highlightMap = new Map(result.characterHighlighting.map((h) => [h.name.toUpperCase(), h]));
            for (const member of result.castList) {
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
        const scriptTitle = file.name.replace(/\.\w+$/, '') || 'Untitled';
        useEditorStore.getState().setDocumentTitle(scriptTitle);
        setSaveAsOpen(true);
      };
      reader.readAsText(file);
    };
    input.click();
  }, [editor, setCurrentProject, setCurrentScriptId, setScripts, setSaveAsOpen]);

  const handleExportFDX = useCallback(() => {
    if (!editor) return;
    const s = useEditorStore.getState();
    downloadFDX(editor.getJSON(), documentTitle, s.characterProfiles, s.tagCategories, s.tags);
  }, [editor, documentTitle]);

  const handleExportFountain = useCallback(() => {
    if (!editor) return;
    downloadFountain(editor.getJSON(), documentTitle);
  }, [editor, documentTitle]);

  const handleExportPDF = useCallback(() => {
    if (!editor) return;
    exportPDF(editor.getJSON(), documentTitle, pageLayout);
  }, [editor, documentTitle, pageLayout]);

  const handleMenuClick = (label: string) => {
    setActiveMenu((prev) => (prev === label ? null : label));
  };

  const handleItemClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.disabled && item.action) {
      item.action();
    }
    setActiveMenu(null);
  };

  const menus: MenuSection[] = [
    {
      label: 'File',
      items: [
        {
          label: 'New Screenplay',
          shortcut: '⌘N',
          action: () => {
            if (!editor) return;
            clearTrackChanges();
            editor.commands.setContent({
              type: 'doc',
              content: [{ type: 'sceneHeading', content: [] }],
            });
            // Clear project state so save will prompt for project/file name
            setCurrentProject(null);
            setCurrentScriptId(null);
            setScripts([]);
            useEditorStore.getState().setDocumentTitle('Untitled Screenplay');
          },
        },
        { separator: true, label: '' },
        { label: 'Import...', action: handleImport },
        { label: 'Open from Project...', action: () => setOpenFromProjectOpen(true) },
        { label: 'Save', shortcut: '\u2318S', action: handleSave },
        { separator: true, label: '' },
        { label: 'Save as Final Draft (.fdx)', action: handleExportFDX },
        { label: 'Save as Fountain (.fountain)', action: handleExportFountain },
        { label: 'Save as PDF', shortcut: '\u2318P', action: handleExportPDF },
        { separator: true, label: '' },
        { label: 'Check In...', action: handleCheckinOpen },
        { label: 'Version History', action: () => setVersionHistoryOpen(true) },
        { separator: true, label: '' },
        { label: 'Page Setup...', action: () => setPageSetupOpen(true) },
        { label: 'Print...', shortcut: '\u2318P', action: () => window.print() },
        { separator: true, label: '' },
        { label: 'Manage Projects...', action: () => { window.location.href = '/projects'; } },
        { separator: true, label: '' },
        { label: isCollabActive ? '\u2713 Collaborate...' : 'Collaborate...', action: onCollaborate },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', action: () => { try { editor?.chain().focus().undo().run(); } catch {} } },
        { label: 'Redo', shortcut: '⇧⌘Z', action: () => { try { editor?.chain().focus().redo().run(); } catch {} } },
        { separator: true, label: '' },
        { label: 'Select All', shortcut: '⌘A', action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        { label: 'Find & Replace...', shortcut: '⌘F', action: () => setSearchOpen(true) },
        { label: 'Go to Page...', shortcut: '⌘G', action: () => setGoToPageOpen(true) },
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
        { label: 'Navigator', action: toggleNavigator },
        { label: 'Index Cards', action: toggleIndexCards },
        { label: 'Beat Board', action: toggleBeatBoard },
        { label: 'Script Notes', action: toggleScriptNotes },
        { label: 'Characters', action: toggleCharacterProfiles },
        { label: 'Tags', action: toggleTagsPanel },
        { separator: true, label: '' },
        { label: notesVisible ? '\u2713 Note Highlights' : 'Note Highlights', action: () => setNotesVisible(!notesVisible) },
        { label: tagsVisible ? '\u2713 Tag Highlights' : 'Tag Highlights', action: () => setTagsVisible(!tagsVisible) },
        { separator: true, label: '' },
        {
          label: trackChangesEnabled
            ? '\u2713 Track Changes'
            : 'Track Changes Since Last Check-In',
          action: handleTrackChangesToggle,
        },
        { label: 'Compare with Version\u2026', action: () => setCompareVersionOpen(true) },
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
        { label: revisionMode ? '✓ Revision Mode' : 'Revision Mode', action: () => setRevisionMode(!revisionMode) },
        { label: 'Tagging...', action: toggleTagsPanel },
        { separator: true, label: '' },
        { label: 'Scene Numbers...', disabled: true },
        { label: 'Lock Pages', disabled: true },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Asset Manager', action: () => useAssetStore.getState().toggleAssetManager() },
        { separator: true, label: '' },
        { label: spellCheckEnabled ? '\u2713 Spell Check' : 'Spell Check', action: toggleSpellCheck },
        { separator: true, label: '' },
        { label: 'Character Highlighter', action: toggleCharacterProfiles },
        { label: 'SmartType', disabled: true },
        { separator: true, label: '' },
        { label: 'Statistics...', disabled: true },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'About OpenDraft',
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

  return (
    <>
    <div className="menu-bar" ref={menuRef}>
      {menus.map((menu) => (
        <div
          key={menu.label}
          className={`menu-item ${activeMenu === menu.label ? 'active' : ''}`}
          onClick={() => handleMenuClick(menu.label)}
          onMouseEnter={() => {
            if (activeMenu) setActiveMenu(menu.label);
          }}
        >
          <span className="menu-label">{menu.label}</span>
          {activeMenu === menu.label && (
            <div className="menu-dropdown">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="menu-separator" />
                ) : (
                  <div
                    key={item.label}
                    className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                    onClick={(e) => handleItemClick(item, e)}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="menu-shortcut">{item.shortcut}</span>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
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
          <div className="dialog-header">About OpenDraft</div>
          <div className="dialog-body about-body">
            <div className="about-title">OpenDraft</div>
            <div className="about-version">Version 0.3.0</div>
            <div className="about-tagline">Free, open-source screenwriting software</div>

            <div className="about-whats-new">
              <div className="about-section-title">What's New in 0.3.0</div>
              <ul className="about-list">
                <li><strong>Track Changes</strong> — Compare your script against any checked-in version with inline insertions (green) and deletions (red strikethrough). Editable while viewing changes.</li>
                <li><strong>Git History Viewer</strong> — View any version of your script in full read-only editor mode with clear visual feedback.</li>
                <li><strong>Entity-Based Tagging</strong> — Tag reusable entities (props, sets, costumes) across multiple scenes. Same entity, multiple occurrences, shared notes.</li>
                <li><strong>Location Navigator</strong> — Locations auto-extracted from scene headings with batch rename across the entire script.</li>
                <li><strong>Scene Reordering</strong> — Drag and drop scenes in Index Cards view to rearrange your script structure.</li>
                <li><strong>Dark / Light Theme</strong> — Switch via View menu. Editor page stays white in both themes.</li>
                <li><strong>Page Setup</strong> — Configure page size, margins, and header/footer from File menu.</li>
                <li><strong>Project Organization</strong> — Drag-drop, pin, color-code, and sort projects and scripts.</li>
                <li><strong>Print Fix</strong> — Multi-page printing now works correctly.</li>
                <li><strong>Draggable Find &amp; Replace</strong> — Move the search panel anywhere on screen.</li>
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
