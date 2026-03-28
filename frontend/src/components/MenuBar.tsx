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
  const handleCheckin = useCallback(async () => {
    if (!currentProject) {
      alert('No project active. Import a file first.');
      return;
    }
    // Save first so the latest content is on disk
    if (editor && currentScriptId) {
      try {
        const content = buildSaveContent();
        await api.saveScript(currentProject.id, currentScriptId, { content });
      } catch (err) {
        console.error('Auto-save before checkin failed:', err);
      }
    }
    const message = prompt('Enter a version description:', '');
    if (!message) return;
    try {
      const result = await api.checkin(currentProject.id, message);
      alert(result.hash ? `Version saved: ${result.short_hash}` : result.message);
    } catch (err) {
      alert(`Check in failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

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

        // Create project + script in backend
        const scriptTitle = file.name.replace(/\.\w+$/, '') || 'Untitled';
        const projectName = prompt('Project name:', 'Default Project');
        if (!projectName) return;

        try {
          // Create or get existing project
          let project;
          try {
            project = await api.createProject(projectName);
          } catch {
            // Project may already exist — try to find it
            const projects = await api.listProjects();
            project = projects.find(
              (p) => p.name.toLowerCase() === projectName.toLowerCase()
            );
            if (!project) {
              console.error('Could not create or find project');
              return;
            }
          }
          setCurrentProject(project);

          // Create a script inside the project with editor content + store metadata
          const scriptResp = await api.createScript(project.id, {
            title: scriptTitle,
            content: buildSaveContent() || editor.getJSON(),
          });
          setCurrentScriptId(scriptResp.meta.id);

          // Refresh script list
          const scripts = await api.listScripts(project.id);
          setScripts(scripts);

          useEditorStore.getState().setDocumentTitle(scriptTitle);
        } catch (err) {
          console.error('Failed to save imported file to project:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [editor, setCurrentProject, setCurrentScriptId, setScripts]);

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
        { label: 'Check In...', action: handleCheckin },
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
            alert('OpenDraft v0.1.0\nOpen-source screenwriting software'),
        },
        {
          label: 'Keyboard Shortcuts',
          action: () =>
            alert(
              '⌘1-8: Element types\nTab: Next element\nEnter: Continue/next element\n⌘B/I/U: Bold/Italic/Underline\n⌘Z: Undo | ⇧⌘Z: Redo\n⌘F: Find & Replace\n⌘G: Go to Page'
            ),
        },
      ],
    },
  ];

  return (
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
  );
};

export default MenuBar;
