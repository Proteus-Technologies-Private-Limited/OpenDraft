import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import {
  useEditorStore,
  ELEMENT_LABELS,
  NOTE_COLORS,
  type NoteColor,
  type ElementType,
  type NoteFilter,
} from '../stores/editorStore';
import { useAssetStore, type Asset } from '../stores/assetStore';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { isTauri, openExternal } from '../services/platform';
import { FaCrosshairs, FaTrash } from 'react-icons/fa';
import {
  removeScriptNoteMarks,
  recolorScriptNoteMarks,
  findScriptNotePos,
} from '../editor/scriptNoteMarks';
import { showToast } from './Toast';
import { useFootnotePlan } from '../hooks/useFootnotePlan';
import { resolveFootnotes, type NotePlacement } from '../stores/editorStore';
import { noteEntryLabel } from '../utils/noteNumbering';
import {
  isNoteResolved,
  knownPeople,
  noteIsForPerson,
  samePerson,
  splitMention,
  type NoteThreadUpdate,
} from '../utils/noteThreads';
import { useSettingsStore } from '../stores/settingsStore';
import Select from './Select';
import NoteThread, { MentionDropdown } from './NoteThread';
import {
  buildMentionSuggestions,
  insertSuggestion,
  mentionQueryAt,
  type MentionSuggestion,
} from '../utils/noteMentions';

/** Open a URL in the default browser. Uses Tauri invoke on desktop, window.open on web. */
const openInBrowser = (url: string) => {
  // Same path on every platform — see openExternal. The `open_url` command
  // this used to invoke has no mobile implementation behind it.
  void openExternal(url).catch((err: unknown) => console.error('Failed to open URL:', err));
};

interface ScriptNotesProps {
  editor: Editor | null;
  style?: React.CSSProperties;
}

/** Check if a string looks like an image URL */
const isImageUrl = (url: string) =>
  /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url);

/** Check if a string looks like a video URL */
const isVideoUrl = (url: string) =>
  /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) ||
  /youtube\.com\/watch|youtu\.be\/|vimeo\.com\//i.test(url);

/** Convert YouTube/Vimeo URL to embeddable URL */
const toEmbedUrl = (url: string): string | null => {
  // YouTube
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  // Vimeo
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
};


/**
 * Render note content with media embeds, @asset references and @mentions.
 * - URLs on their own line that look like images render as <img>
 * - URLs that look like videos render as <video> or iframe embed
 * - @AssetName references render as clickable asset links
 * - @Person_Name mentions of a known collaborator render as a name chip
 */
const NoteContentDisplay: React.FC<{
  content: string;
  assets: Asset[];
  projectId: string | null;
  people?: string[];
  me?: string;
}> = ({ content, assets, projectId, people = [], me = '' }) => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Image URL on its own line
    if (isImageUrl(line) && /^https?:\/\//.test(line)) {
      elements.push(
        <div key={i} className="note-media-embed">
          <img src={line} alt="" loading="lazy" />
        </div>,
      );
      continue;
    }

    // Video URL on its own line
    if (isVideoUrl(line) && /^https?:\/\//.test(line)) {
      const embedUrl = toEmbedUrl(line);
      if (embedUrl) {
        if (isTauri()) {
          // In Tauri, YouTube/Vimeo iframes don't work (origin restriction).
          // Show as a clickable link that opens in the default browser.
          elements.push(
            <div key={i} className="note-media-embed note-media-video">
              <a
                href={line}
                target="_blank"
                rel="noreferrer"
                className="note-video-link"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openInBrowser(line); }}
              >
                {line}
              </a>
            </div>,
          );
        } else {
          elements.push(
            <div key={i} className="note-media-embed note-media-video">
              <iframe src={embedUrl} allowFullScreen title="video" />
            </div>,
          );
        }
      } else {
        elements.push(
          <div key={i} className="note-media-embed">
            <video src={line} controls preload="metadata" />
          </div>,
        );
      }
      continue;
    }

    // Parse @asset references inline
    const parts = line.split(/(@\S+)/g);
    const lineElements: React.ReactNode[] = [];
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (part.startsWith('@')) {
        const assetName = part.slice(1);
        const asset = assets.find(
          (a) => a.original_name.toLowerCase() === assetName.toLowerCase() ||
                 a.original_name.replace(/\s+/g, '_').toLowerCase() === assetName.toLowerCase(),
        );
        if (asset) {
          const isImg = asset.mime_type.startsWith('image/');
          const url = projectId
            ? api.getAssetUrl(projectId, asset.id)
            : '#';
          if (isImg) {
            lineElements.push(
              <span key={j} className="note-asset-ref">
                <img src={url} alt={asset.original_name} className="note-asset-thumb" loading="lazy" />
                <span className="note-asset-name">{part}</span>
              </span>,
            );
          } else {
            lineElements.push(
              <a key={j} className="note-asset-ref note-asset-link" href={url} target="_blank" rel="noreferrer">
                {part}
              </a>,
            );
          }
        } else {
          // An asset wins over a person of the same name: asset references
          // came first, and an existing note must keep meaning what it meant.
          const mention = splitMention(part, people);
          if (mention) {
            const { person, trail } = mention;
            lineElements.push(
              <span
                key={j}
                className={`note-mention${samePerson(person, me) ? ' note-mention-me' : ''}`}
                title={samePerson(person, me) ? 'Mentions you' : `Mentions ${person}`}
              >
                @{person}
              </span>,
            );
            // Keep what trailed the name — "@Jane_Doe," keeps its comma.
            if (trail) lineElements.push(<span key={`${j}-t`}>{trail}</span>);
          } else {
            lineElements.push(
              <span key={j} className="note-asset-ref note-asset-unresolved">{part}</span>,
            );
          }
        }
      } else {
        // Detect URLs in plain text and render as clickable links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const textParts = part.split(urlRegex);
        for (let k = 0; k < textParts.length; k++) {
          const tp = textParts[k];
          if (urlRegex.test(tp)) {
            const handleClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              openInBrowser(tp);
            };
            lineElements.push(
              <a key={`${j}-${k}`} href={tp} target="_blank" rel="noreferrer" className="note-inline-link" onClick={handleClick}>
                {tp}
              </a>,
            );
          } else if (tp) {
            lineElements.push(<span key={`${j}-${k}`}>{tp}</span>);
          }
          // Reset regex lastIndex since we reuse it
          urlRegex.lastIndex = 0;
        }
      }
    }

    elements.push(
      <div key={i} className="note-content-line">
        {lineElements}
      </div>,
    );
  }

  return <div className="note-content-rendered">{elements}</div>;
};

const ScriptNotes: React.FC<ScriptNotesProps> = ({ editor, style }) => {
  const {
    notes,
    scriptNotesOpen,
    scenes,
    updateNote,
    deleteNote,
    toggleScriptNotes,
    noteFilter,
    setNoteFilter,
    generalNotes,
    addGeneralNote,
    updateGeneralNote,
    deleteGeneralNote,
    notesActiveTab: activeTab,
    setNotesActiveTab: setActiveTab,
  } = useEditorStore();

  const { assets } = useAssetStore();
  const { currentProject, currentScriptId } = useProjectStore();
  const projectId = currentProject?.id ?? null;

  // ── Who notes are from and for ──
  const showResolved = useEditorStore((st) => st.notesShowResolved);
  const setShowResolved = useEditorStore((st) => st.setNotesShowResolved);
  const collabSelfName = useEditorStore((st) => st.collabSelfName);
  const collabPeerNames = useEditorStore((st) => st.collabPeerNames);
  const accountName = useSettingsStore((st) => st.collabAuth.user?.displayName ?? '');
  const signedIn = useSettingsStore((st) => !!st.collabAuth.accessToken);
  const me = (collabSelfName || accountName).trim();

  // The people invited to collaborate on this script, from the collaboration
  // server, so a note can be assigned to someone who is not online right now.
  // Only the account that sent the invites can list them; for anyone else
  // this quietly finds nobody and the panel falls back to who is connected.
  const [invitedNames, setInvitedNames] = useState<string[]>([]);
  useEffect(() => {
    setInvitedNames([]);
    if (!scriptNotesOpen || !signedIn || !projectId || !currentScriptId) return;
    let cancelled = false;
    api.listCollabSessions(projectId, currentScriptId)
      .then((sessions) => {
        if (!cancelled) setInvitedNames(sessions.map((x) => x.collaborator_name).filter(Boolean));
      })
      .catch(() => { /* offline, or no server: who is connected is enough */ });
    return () => { cancelled = true; };
  }, [scriptNotesOpen, signedIn, projectId, currentScriptId]);

  const people = useMemo(
    () => knownPeople([...notes, ...generalNotes], [me, ...collabPeerNames, ...invitedNames]),
    [notes, generalNotes, me, collabPeerNames, invitedNames],
  );

  /** Only notes waiting on the writer: assigned to them or mentioning them. */
  const [forMeOnly, setForMeOnly] = useState(false);

  // Which notes print, and what number each will carry. Null while nothing
  // prints, which is what keeps the panel exactly as it was for everyone who
  // never turns this on.
  const footnotePlan = useFootnotePlan(editor);
  const pageLayout = useEditorStore((st) => st.pageLayout);
  const setPageLayout = useEditorStore((st) => st.setPageLayout);
  const setFootnoteDialogOpen = useEditorStore((st) => st.setFootnoteDialogOpen);
  const footnoteSettings = resolveFootnotes(pageLayout);
  /** Where a note goes: its own choice, or the document's if it has none. */
  const notePlacementOf = useCallback(
    (note: { printPlacement?: NotePlacement }): NotePlacement =>
      note.printPlacement ?? footnoteSettings.placement,
    [footnoteSettings.placement],
  );

  /**
   * The number this note will carry, or null if it will not print.
   *
   * Read from the plan rather than from the note's own position, because the
   * numbering is by document order and a note inserted earlier renumbers every
   * note after it — which the writer should be able to see happen.
   */
  const markerFor = useCallback((noteId: string): string | null => {
    if (!footnotePlan) return null;
    const entry = footnotePlan.entryById.get(noteId);
    if (!entry) return null;
    return noteEntryLabel(entry.number, footnotePlan.settings.numberFormat);
  }, [footnotePlan]);

  /** The paginator has to be told: none of this lives in the document. */
  const nudgePagination = useCallback(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta('forceRepaginate', true).setMeta('addToHistory', false),
    );
  }, [editor]);

  /** Turning the first note on while the document switch is off would look like
   *  a dead control, so switch the document on too and say so. */
  const ensureEnabled = useCallback(() => {
    const fn = resolveFootnotes(useEditorStore.getState().pageLayout);
    if (fn.enabled) return;
    setPageLayout({ ...useEditorStore.getState().pageLayout, footnotes: { ...fn, enabled: true } });
    showToast('Notes now print in the screenplay. Format \u2192 Footnotes & Endnotes to configure.', 'info');
  }, [setPageLayout]);

  /**
   * Where one note prints. `''` means it does not.
   *
   * A choice matching the document's own Location is stored as no choice at
   * all, so the note keeps following the document — change the Location later
   * and every note that was never given one of its own moves with it.
   */
  const handlePlacementChange = useCallback((id: string, value: string) => {
    if (!value) {
      updateNote(id, { printInScript: false });
      nudgePagination();
      return;
    }
    const placement = value as NotePlacement;
    const fn = resolveFootnotes(useEditorStore.getState().pageLayout);
    updateNote(id, {
      printInScript: true,
      printPlacement: placement === fn.placement ? undefined : placement,
    });
    ensureEnabled();
    nudgePagination();
  }, [updateNote, ensureEnabled, nudgePagination]);

  /**
   * A general note belongs to the file, not to a line of it, so there is
   * nowhere in the script to put a reference and no page that is its own. It
   * always prints at the end, whatever the document's placement setting says.
   */
  const handleGeneralPrintToggle = useCallback((id: string, next: boolean) => {
    updateGeneralNote(id, { printInScript: next });
    if (next) ensureEnabled();
    nudgePagination();
  }, [updateGeneralNote, ensureEnabled, nudgePagination]);

  // Track which note is being edited (shows textarea), null = preview mode for all
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Track which general note is being edited
  const [editingGeneralNoteId, setEditingGeneralNoteId] = useState<string | null>(null);

  // @ autocomplete state: collaborators and assets
  const [assetQuery, setAssetQuery] = useState<string | null>(null);
  const [assetSuggestions, setAssetSuggestions] = useState<MentionSuggestion[]>([]);
  const [assetSugIdx, setAssetSugIdx] = useState(0);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Sync external filter changes (from context menu) to panel
  const [localFilter, setLocalFilter] = useState<NoteFilter>(noteFilter);
  useEffect(() => {
    setLocalFilter(noteFilter);
  }, [noteFilter]);

  // Unique context labels and element types from notes for filter chips
  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const contexts = new Set<string>();
    for (const n of notes) {
      types.add(n.elementType);
      if (n.contextLabel) contexts.add(n.contextLabel);
    }
    return {
      types: Array.from(types).sort(),
      contexts: Array.from(contexts).sort(),
    };
  }, [notes]);

  /** The thread filters both tabs share: resolved notes, and notes for me. */
  const passesThreadFilters = useCallback(
    (n: Parameters<typeof noteIsForPerson>[0]) => {
      if (!showResolved && isNoteResolved(n)) return false;
      if (forMeOnly && me && !noteIsForPerson(n, me)) return false;
      return true;
    },
    [showResolved, forMeOnly, me],
  );

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      // If filtering to a specific note by ID, only show that one — resolved
      // or not, since it was asked for by name.
      if (localFilter.noteId) return n.id === localFilter.noteId;
      if (localFilter.elementType && n.elementType !== localFilter.elementType) return false;
      if (localFilter.contextLabel && n.contextLabel !== localFilter.contextLabel) return false;
      if (localFilter.color && n.color !== localFilter.color) return false;
      return passesThreadFilters(n);
    });
  }, [notes, localFilter, passesThreadFilters]);

  const visibleGeneralNotes = useMemo(
    () => generalNotes.filter(passesThreadFilters),
    [generalNotes, passesThreadFilters],
  );

  const resolvedCount = useMemo(
    () => notes.filter(isNoteResolved).length + generalNotes.filter(isNoteResolved).length,
    [notes, generalNotes],
  );
  const forMeCount = useMemo(
    () => (me ? [...notes, ...generalNotes].filter((n) => !isNoteResolved(n) && noteIsForPerson(n, me)).length : 0),
    [notes, generalNotes, me],
  );

  const isFiltered = localFilter.elementType || localFilter.contextLabel || localFilter.color || localFilter.noteId;
  /** Fewer notes are listed than exist — said in the tab count. */
  const scriptCountFiltered = filteredNotes.length !== notes.length;

  const getSceneName = useCallback(
    (sceneId: string | null) => {
      if (!sceneId) return null;
      // A note's sceneId counts scenes from 0 (`scene-0` is the first, see
      // ScriptContextMenu / Toolbar), while the navigator's scene ids count
      // from 1 — so look the scene up by position, not by id.
      const index = Number(/^scene-(\d+)$/.exec(sceneId)?.[1]);
      const scene = Number.isInteger(index) ? scenes[index] : undefined;
      return scene ? scene.heading : null;
    },
    [scenes],
  );

  const getNoteColorHex = (colorName: NoteColor): string => {
    const c = NOTE_COLORS.find((nc) => nc.name === colorName);
    return c ? c.hex : NOTE_COLORS[0].hex;
  };

  const handleClearFilter = useCallback(() => {
    const cleared: NoteFilter = { elementType: null, contextLabel: null, color: null, noteId: null };
    setLocalFilter(cleared);
    setNoteFilter(cleared);
  }, [setNoteFilter]);

  const toggleTypeFilter = useCallback(
    (type: string) => {
      const next: NoteFilter = {
        ...localFilter,
        elementType: localFilter.elementType === type ? null : type,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const toggleContextFilter = useCallback(
    (ctx: string) => {
      const next: NoteFilter = {
        ...localFilter,
        contextLabel: localFilter.contextLabel === ctx ? null : ctx,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const toggleColorFilter = useCallback(
    (color: NoteColor) => {
      const next: NoteFilter = {
        ...localFilter,
        color: localFilter.color === color ? null : color,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const [pendingDeleteGeneralNoteId, setPendingDeleteGeneralNoteId] = useState<string | null>(null);

  const handleDeleteRequest = useCallback((id: string) => {
    setPendingDeleteNoteId(id);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const id = pendingDeleteNoteId;
    if (!id) return;
    setPendingDeleteNoteId(null);
    // The highlight goes with the note. Both halves have to happen, so this
    // does not run through a chain that could abandon them together.
    removeScriptNoteMarks(editor, id);
    deleteNote(id);
    // Then check it actually went. A transaction can be lost if something else
    // dispatches one built from the state just before it — repagination, a
    // collaborator's edit, an autosave. Sweeping again on the next frame costs
    // nothing when the first attempt worked, and this is not a place to leave a
    // highlight behind: the note it belonged to no longer exists to remove it.
    requestAnimationFrame(() => {
      if (findScriptNotePos(editor, id) !== null) {
        console.warn('[notes] the highlight outlived its note; removing it again', id);
        removeScriptNoteMarks(editor, id);
      }
    });
    // A filter pinned to this note now points at nothing, which empties the
    // panel and reads as "every note was deleted" while the other notes are
    // still highlighted in the script. Let go of it.
    if (useEditorStore.getState().noteFilter.noteId === id) {
      setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId: null });
    }
  }, [editor, deleteNote, pendingDeleteNoteId, setNoteFilter]);

  const handleColorChange = useCallback(
    (id: string, color: NoteColor) => {
      updateNote(id, { color });
      recolorScriptNoteMarks(editor, id, getNoteColorHex(color));
    },
    [editor, updateNote],
  );

  const handleNavigateToNote = useCallback(
    (noteId: string) => {
      if (!editor) return;

      const targetPos = findScriptNotePos(editor, noteId);
      if (targetPos === null) return;

      editor.chain().focus().setTextSelection(targetPos).run();
      const coords = editor.view.coordsAtPos(targetPos);
      const editorMain = document.querySelector('.editor-main');
      if (editorMain && coords) {
        const rect = editorMain.getBoundingClientRect();
        const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
        editorMain.scrollTo({ top: scrollTo, behavior: 'smooth' });
      }

      // Land visibly. Scrolling alone leaves the writer hunting for which words
      // the note was about, especially when highlights are turned off.
      const marked = editor.view.dom.querySelectorAll(`[data-note-id="${CSS.escape(noteId)}"]`);
      marked.forEach((el) => {
        el.classList.remove('script-note-flash');
        // Force a reflow so re-adding the class restarts the animation when the
        // same note is jumped to twice.
        void (el as HTMLElement).offsetWidth;
        el.classList.add('script-note-flash');
      });
      window.setTimeout(() => {
        marked.forEach((el) => el.classList.remove('script-note-flash'));
      }, 1400);
    },
    [editor],
  );

  // ── General notes handlers ──
  const handleAddGeneralNote = useCallback(() => {
    const id = addGeneralNote({ title: '', content: '', color: 'Yellow' as NoteColor });
    setEditingGeneralNoteId(id);
  }, [addGeneralNote]);

  const handleDeleteGeneralNoteConfirm = useCallback(() => {
    if (!pendingDeleteGeneralNoteId) return;
    deleteGeneralNote(pendingDeleteGeneralNoteId);
    setPendingDeleteGeneralNoteId(null);
    if (editingGeneralNoteId === pendingDeleteGeneralNoteId) setEditingGeneralNoteId(null);
  }, [deleteGeneralNote, pendingDeleteGeneralNoteId, editingGeneralNoteId]);

  // When external filter opens panel to a specific script note, switch to script tab
  useEffect(() => {
    if (noteFilter.noteId || noteFilter.elementType || noteFilter.contextLabel || noteFilter.color) {
      setActiveTab('script');
    }
  }, [noteFilter]);

  /** Handle @asset autocomplete inside textarea */
  const handleTextareaChange = useCallback(
    (noteId: string, value: string) => {
      updateNote(noteId, { content: value });

      // Check for @mention trigger
      const textarea = textareaRefs.current.get(noteId);
      if (!textarea) return;
      const query = mentionQueryAt(value, textarea.selectionStart);
      if (query !== null) {
        setAssetQuery(query.toLowerCase());
        setAssetSuggestions(buildMentionSuggestions(query, people, assets));
        setAssetSugIdx(0);
      } else {
        setAssetQuery(null);
        setAssetSuggestions([]);
      }
    },
    [updateNote, assets, people],
  );

  const insertAssetRef = useCallback(
    (noteId: string, suggestion: MentionSuggestion) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      const textarea = textareaRefs.current.get(noteId);
      if (!textarea) return;

      const next = insertSuggestion(note.content, textarea.selectionStart, suggestion);
      if (next.value === note.content) return;
      updateNote(noteId, { content: next.value });

      setAssetQuery(null);
      setAssetSuggestions([]);

      // Restore cursor position after insert
      requestAnimationFrame(() => {
        textarea.setSelectionRange(next.caret, next.caret);
        textarea.focus();
      });
    },
    [notes, updateNote],
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, noteId: string) => {
      if (assetSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAssetSugIdx((i) => Math.min(i + 1, assetSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAssetSugIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertAssetRef(noteId, assetSuggestions[assetSugIdx]);
        } else if (e.key === 'Escape') {
          setAssetQuery(null);
          setAssetSuggestions([]);
        }
      }
    },
    [assetSuggestions, assetSugIdx, insertAssetRef],
  );

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderThreadContent = (text: string) => (
    <NoteContentDisplay content={text} assets={assets} projectId={projectId} people={people} me={me} />
  );

  const { shouldRender, animationState } = useDelayedUnmount(scriptNotesOpen, 250);
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleScriptNotes, enabled: shouldRender });

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered'
    ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <div ref={panelRef} className={`script-notes-panel ${panelClass}`} style={style}>
      <div className="script-notes-header">
        <span className="script-notes-title">Notes</span>
        {/* Right where the writer is when they set a note to print. */}
        <button
          className="script-notes-settings"
          onClick={() => setFootnoteDialogOpen(true)}
          title="Footnote and endnote settings"
        >
          &#9881;
        </button>
        <button className="script-notes-close" onClick={toggleScriptNotes} title="Close">
          &times;
        </button>
      </div>

      {/* ── Tab switcher ── */}
      <div className="sn-tabs">
        <button
          className={`sn-tab${activeTab === 'general' ? ' active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General{generalNotes.length > 0
            ? ` (${visibleGeneralNotes.length !== generalNotes.length ? `${visibleGeneralNotes.length}/` : ''}${generalNotes.length})`
            : ''}
        </button>
        <button
          className={`sn-tab${activeTab === 'script' ? ' active' : ''}`}
          onClick={() => setActiveTab('script')}
        >
          Script{notes.length > 0 ? ` (${scriptCountFiltered ? `${filteredNotes.length}/` : ''}${notes.length})` : ''}
        </button>
      </div>

      {/* ── Thread filters, shared by both tabs ── */}
      {(resolvedCount > 0 || me) && (
        <div className="sn-thread-filters">
          {me && (
            <button
              className={`sn-chip${forMeOnly ? ' active' : ''}`}
              onClick={() => setForMeOnly((v) => !v)}
              title="Only open notes assigned to you or mentioning you"
              aria-pressed={forMeOnly}
            >
              For me{forMeCount > 0 ? ` (${forMeCount})` : ''}
            </button>
          )}
          {resolvedCount > 0 && (
            <label className="sn-show-resolved">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved ({resolvedCount})
            </label>
          )}
        </div>
      )}

      {activeTab === 'script' && <>
      {/* ── Multi-dimensional filter bar ── */}
      <div className="script-notes-filters">
        {/* Active filter summary + clear */}
        {isFiltered && (
          <div className="sn-filter-active">
            {localFilter.noteId && (
              <span className="sn-filter-chip" onClick={handleClearFilter}>
                Selected note
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.elementType && (
              <span
                className="sn-filter-chip"
                onClick={() => toggleTypeFilter(localFilter.elementType!)}
              >
                {ELEMENT_LABELS[localFilter.elementType as ElementType] || localFilter.elementType}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.contextLabel && (
              <span
                className="sn-filter-chip sn-chip-context"
                onClick={() => toggleContextFilter(localFilter.contextLabel!)}
              >
                {localFilter.contextLabel}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.color && (
              <span
                className="sn-filter-chip"
                onClick={() => toggleColorFilter(localFilter.color!)}
                style={{ borderColor: getNoteColorHex(localFilter.color) }}
              >
                {localFilter.color}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            <button className="sn-filter-clear" onClick={handleClearFilter}>
              Show All
            </button>
          </div>
        )}

        {/* Type filter row */}
        {filterOptions.types.length > 1 && (
          <div className="sn-filter-row">
            <span className="sn-filter-label">Type</span>
            <div className="sn-filter-chips">
              {filterOptions.types.map((t) => (
                <button
                  key={t}
                  className={`sn-chip${localFilter.elementType === t ? ' active' : ''}`}
                  onClick={() => toggleTypeFilter(t)}
                >
                  {ELEMENT_LABELS[t as ElementType] || t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Context filter row */}
        {filterOptions.contexts.length > 0 && (
          <div className="sn-filter-row">
            <span className="sn-filter-label">Context</span>
            <div className="sn-filter-chips">
              {filterOptions.contexts.map((c) => (
                <button
                  key={c}
                  className={`sn-chip sn-chip-ctx${localFilter.contextLabel === c ? ' active' : ''}`}
                  onClick={() => toggleContextFilter(c)}
                >
                  {c.length > 25 ? c.slice(0, 25) + '...' : c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Color filter */}
        <div className="sn-filter-row sn-filter-colors">
          {NOTE_COLORS.map((c) => {
            const count = notes.filter((n) => n.color === c.name).length;
            if (count === 0) return null;
            return (
              <button
                key={c.name}
                className={`sn-color-btn${localFilter.color === c.name ? ' active' : ''}`}
                onClick={() => toggleColorFilter(c.name)}
                title={`${c.name} (${count})`}
                style={{ '--swatch-color': c.hex } as React.CSSProperties}
              >
                <span className="swatch" />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Notes list ── */}
      <div className="script-notes-list">
        {filteredNotes.length === 0 ? (
          <div className="script-notes-empty">
            {notes.length === 0
              ? 'No notes yet. Select text in the editor, right-click, and choose "Add Script Note".'
              : !isFiltered && !forMeOnly && !showResolved && notes.every(isNoteResolved)
                ? 'Every note is resolved. Tick "Show resolved" to see them.'
                : 'No notes match this filter.'}
          </div>
        ) : (
          filteredNotes.map((note) => {
            const hex = getNoteColorHex(note.color);
            const sceneName = getSceneName(note.sceneId);
            const elemLabel = ELEMENT_LABELS[note.elementType as ElementType] || note.elementType;
            const isEditing = editingNoteId === note.id;
            const marker = markerFor(note.id);
            const resolved = isNoteResolved(note);

            return (
              <div
                key={note.id}
                className={`note-item${resolved ? ' note-item-resolved' : ''}`}
                style={{ borderLeftColor: hex }}
              >
                <div className="note-item-header">
                  <div className="note-item-context">
                    <span className="note-item-element">{elemLabel}</span>
                    {note.contextLabel && (
                      <span
                        className="note-item-ctx-label"
                        onClick={() => toggleContextFilter(note.contextLabel)}
                        title={`Filter by "${note.contextLabel}"`}
                      >
                        {note.contextLabel}
                      </span>
                    )}
                    {sceneName && (
                      <span className="note-item-scene">{sceneName}</span>
                    )}
                    {marker && (
                      <span className="note-item-fn-badge">
                        {notePlacementOf(note) === 'endnote' ? 'Endnote' : 'Footnote'} {marker}
                      </span>
                    )}
                    {!marker && note.printInScript && (
                      <span className="note-item-fn-badge muted">Not printed &mdash; empty</span>
                    )}
                  </div>
                  <span className="note-item-date">
                    {note.author && <span className="note-item-author">{note.author} &middot; </span>}
                    {formatDate(note.createdAt)}
                  </span>
                </div>

                {note.anchorText && (
                  <div
                    className="note-item-anchor"
                    onClick={() => handleNavigateToNote(note.id)}
                    title="Click to navigate to this text"
                  >
                    &ldquo;{note.anchorText}&rdquo;
                  </div>
                )}

                {/* Note content: edit mode or rendered preview */}
                {isEditing ? (
                  <div className="note-edit-area">
                    <textarea
                      ref={(el) => {
                        if (el) textareaRefs.current.set(note.id, el);
                      }}
                      className="note-item-content"
                      value={note.content}
                      onChange={(e) => handleTextareaChange(note.id, e.target.value)}
                      onKeyDown={(e) => handleTextareaKeyDown(e, note.id)}
                      onBlur={() => {
                        // Delay to allow suggestion click
                        setTimeout(() => {
                          setEditingNoteId(null);
                          setAssetQuery(null);
                          setAssetSuggestions([]);
                        }, 200);
                      }}
                      placeholder="Write your note... (@ to mention a collaborator or reference an asset, paste media URLs on their own line)"
                      rows={3}
                      autoFocus
                    />
                    {assetSuggestions.length > 0 && assetQuery !== null && (
                      <MentionDropdown
                        suggestions={assetSuggestions}
                        selected={assetSugIdx}
                        onPick={(sug) => insertAssetRef(note.id, sug)}
                      />
                    )}
                  </div>
                ) : (
                  <div
                    className="note-item-preview"
                    onClick={() => setEditingNoteId(note.id)}
                    title="Click to edit"
                  >
                    {note.content ? (
                      <NoteContentDisplay
                        content={note.content}
                        assets={assets}
                        projectId={projectId}
                        people={people}
                        me={me}
                      />
                    ) : (
                      <span className="note-item-placeholder">Click to add note...</span>
                    )}
                  </div>
                )}

                <NoteThread
                  note={note}
                  me={me}
                  people={people}
                  assets={assets}
                  onUpdate={(updates: NoteThreadUpdate) => updateNote(note.id, updates)}
                  renderContent={renderThreadContent}
                  formatDate={formatDate}
                />

                <div className="note-item-actions">
                  <div className="note-item-colors">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c.name}
                        className={`note-color-dot${note.color === c.name ? ' active' : ''}`}
                        style={{ background: c.hex }}
                        onClick={() => handleColorChange(note.id, c.name)}
                        title={c.name}
                      />
                    ))}
                  </div>
                  <div className="note-item-controls">
                    <Select
                      className={`note-print-select${marker ? ' active' : ''}`}
                      disabled={!note.content.trim()}
                      value={note.printInScript ? notePlacementOf(note) : ''}
                      onChange={(e) => handlePlacementChange(note.id, e.target.value)}
                      title={
                        note.content.trim()
                          ? 'Where this note prints in the screenplay'
                          : 'Add note text first'
                      }
                    >
                      <option value="">Do not print</option>
                      <option value="footnote">Page footer</option>
                      <option value="endnote">End note</option>
                    </Select>
                    <button
                      className="note-icon-btn"
                      onClick={() => handleNavigateToNote(note.id)}
                      title="Scroll to the text this note is attached to"
                      aria-label="Go to the text this note is attached to"
                    >
                      <FaCrosshairs />
                    </button>
                    <button
                      className="note-icon-btn note-icon-danger"
                      onClick={() => handleDeleteRequest(note.id)}
                      title="Delete note"
                      aria-label="Delete note"
                    >
                      <FaTrash />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {pendingDeleteNoteId && (
        <div className="dialog-overlay" onClick={() => setPendingDeleteNoteId(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Note</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>Delete this note? The highlight will also be removed from the script.</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteNoteId(null)}>Cancel</button>
              <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={handleDeleteConfirm}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </>}

      {/* ── General Notes tab ── */}
      {activeTab === 'general' && (
        <>
          <div className="general-notes-toolbar">
            <button className="general-notes-add-btn" onClick={handleAddGeneralNote}>+ Add Note</button>
          </div>
          <div className="script-notes-list">
            {visibleGeneralNotes.length === 0 ? (
              <div className="script-notes-empty">
                {generalNotes.length === 0
                  ? <>No general notes yet. Click &ldquo;+ Add Note&rdquo; to create one.</>
                  : 'No general notes match this filter.'}
              </div>
            ) : (
              visibleGeneralNotes.map((gn) => {
                const hex = getNoteColorHex(gn.color);
                const isEditing = editingGeneralNoteId === gn.id;
                const gnMarker = markerFor(gn.id);
                const resolved = isNoteResolved(gn);
                return (
                  <div key={gn.id} className={`note-item${resolved ? ' note-item-resolved' : ''}`} style={{ borderLeftColor: hex }}>
                    <div className="note-item-header">
                      {gnMarker && (
                        <span className="note-item-fn-badge">Endnote {gnMarker}</span>
                      )}
                      {!gnMarker && gn.printInScript && (
                        <span className="note-item-fn-badge muted">Not printed &mdash; empty</span>
                      )}
                      <span className="note-item-date">
                        {gn.author && <span className="note-item-author">{gn.author} &middot; </span>}
                        {formatDate(gn.createdAt)}
                      </span>
                    </div>
                    {isEditing ? (
                      <>
                        <input
                          className="general-note-title-input"
                          value={gn.title}
                          onChange={(e) => updateGeneralNote(gn.id, { title: e.target.value })}
                          placeholder="Note title..."
                          autoFocus
                        />
                        <textarea
                          className="note-item-content"
                          value={gn.content}
                          onChange={(e) => updateGeneralNote(gn.id, { content: e.target.value })}
                          onBlur={() => setTimeout(() => setEditingGeneralNoteId(null), 200)}
                          placeholder="Write your note..."
                          rows={4}
                        />
                      </>
                    ) : (
                      <div
                        className="note-item-preview"
                        onClick={() => setEditingGeneralNoteId(gn.id)}
                        title="Click to edit"
                      >
                        {gn.title && <div className="general-note-title">{gn.title}</div>}
                        {gn.content ? (
                          <NoteContentDisplay content={gn.content} assets={assets} projectId={projectId} people={people} me={me} />
                        ) : (
                          <span className="note-item-placeholder">
                            {gn.title ? '' : 'Click to add note...'}
                          </span>
                        )}
                      </div>
                    )}
                    <NoteThread
                      note={gn}
                      me={me}
                      people={people}
                      assets={assets}
                      onUpdate={(updates: NoteThreadUpdate) => updateGeneralNote(gn.id, updates)}
                      renderContent={renderThreadContent}
                      formatDate={formatDate}
                    />
                    <div className="note-item-actions">
                      <div className="note-item-colors">
                        {NOTE_COLORS.map((c) => (
                          <button
                            key={c.name}
                            className={`note-color-dot${gn.color === c.name ? ' active' : ''}`}
                            style={{ background: c.hex }}
                            onClick={() => updateGeneralNote(gn.id, { color: c.name })}
                            title={c.name}
                          />
                        ))}
                      </div>
                      <div className="note-item-controls">
                        <Select
                          className={`note-print-select${gnMarker ? ' active' : ''}`}
                          disabled={!gn.content.trim()}
                          value={gn.printInScript ? 'endnote' : ''}
                          onChange={(e) => handleGeneralPrintToggle(gn.id, e.target.value === 'endnote')}
                          title={
                            gn.content.trim()
                              // A general note is attached to the file, not to a
                              // line of it, so there is no page it could sit at
                              // the foot of.
                              ? 'A general note can only print at the end of the script'
                              : 'Add note text first'
                          }
                        >
                          <option value="">Do not print</option>
                          <option value="endnote">End note</option>
                        </Select>
                        <button
                          className="note-icon-btn note-icon-danger"
                          onClick={() => setPendingDeleteGeneralNoteId(gn.id)}
                          title="Delete note"
                          aria-label="Delete note"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {pendingDeleteGeneralNoteId && (
            <div className="dialog-overlay" onClick={() => setPendingDeleteGeneralNoteId(null)}>
              <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">Delete Note</div>
                <div className="dialog-body">
                  <p style={{ margin: 0 }}>Delete this general note?</p>
                </div>
                <div className="dialog-actions">
                  <button onClick={() => setPendingDeleteGeneralNoteId(null)}>Cancel</button>
                  <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={handleDeleteGeneralNoteConfirm}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ScriptNotes;
