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

interface MenuBarProps {
  editor: Editor | null;
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

const MenuBar: React.FC<MenuBarProps> = ({ editor }) => {
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
        { label: 'Print...', shortcut: '\u2318P', action: () => window.print() },
        { separator: true, label: '' },
        { label: 'Manage Projects...', action: () => { window.location.href = '/projects'; } },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', action: () => editor?.chain().focus().undo().run() },
        { label: 'Redo', shortcut: '⇧⌘Z', action: () => editor?.chain().focus().redo().run() },
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
          action: () =>
            showToast('OpenDraft v0.1.0 — Open-source screenwriting software', 'success'),
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
    </>
  );
};

export default MenuBar;
