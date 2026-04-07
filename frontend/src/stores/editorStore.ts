import { create } from 'zustand';
import { uuid } from '../utils/uuid';

// ── View-state persistence helpers ──
const VIEW_STATE_KEY = 'opendraft:viewState';
interface ViewState {
  navigatorOpen?: boolean;
  indexCardsOpen?: boolean;
  beatBoardOpen?: boolean;
  scriptNotesOpen?: boolean;
  characterProfilesOpen?: boolean;
  tagsPanelOpen?: boolean;
  notesVisible?: boolean;
  tagsVisible?: boolean;
  notesActiveTab?: 'script' | 'general';
  zoomLevel?: number;
  toolbarMode?: 'compact' | 'comfortable' | 'hidden';
}
function loadViewState(): ViewState {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveViewState(patch: Partial<ViewState>) {
  try {
    const current = loadViewState();
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch { /* localStorage unavailable */ }
}
const _vs = loadViewState();

export type ElementType =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'general'
  | 'shot'
  | 'newAct'
  | 'endOfAct'
  | 'lyrics'
  | 'showEpisode'
  | 'castList'
  | 'titlePage';

export const ELEMENT_LABELS: Record<ElementType, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  general: 'General',
  shot: 'Shot',
  newAct: 'New Act',
  endOfAct: 'End of Act',
  lyrics: 'Lyrics',
  showEpisode: 'Show/Episode',
  castList: 'Cast List',
  titlePage: 'Title Page',
};

/** Header/footer content for left, center, right positions.
 *  Dynamic fields: {page} = page number, {pages} = total pages,
 *  {title} = document title, {date} = current date, {revision} = revision color. */
export interface HeaderFooterContent {
  left: string;
  center: string;
  right: string;
}

export const DEFAULT_HEADER_CONTENT: HeaderFooterContent = {
  left: '',
  center: '',
  right: '{page}.',
};

export const DEFAULT_FOOTER_CONTENT: HeaderFooterContent = {
  left: '',
  center: '',
  right: '',
};

export interface PageLayout {
  pageWidth: number;     // inches
  pageHeight: number;    // inches
  topMargin: number;     // points
  bottomMargin: number;  // points
  headerMargin: number;  // points
  footerMargin: number;  // points
  leftMargin: number;    // inches (from page edge to content start)
  rightMargin: number;   // inches (from content end to page edge)
  headerContent: HeaderFooterContent;
  footerContent: HeaderFooterContent;
  /** Show header/footer starting from this page number (default 2 = skip first page) */
  headerStartPage: number;
  footerStartPage: number;
}

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  pageWidth: 8.26,
  pageHeight: 11.69,
  topMargin: 72,
  bottomMargin: 72,
  headerMargin: 36,
  footerMargin: 36,
  leftMargin: 1.50,       // Final Draft default LeftIndent for Action
  rightMargin: 0.76,      // 8.26 - 7.50 (default RightIndent)
  headerContent: { ...DEFAULT_HEADER_CONTENT },
  footerContent: { ...DEFAULT_FOOTER_CONTENT },
  headerStartPage: 2,
  footerStartPage: 1,
};

export interface SceneInfo {
  id: string;
  heading: string;
  sceneNumber: number | null;
  color: string;
  synopsis: string;
}

export const NOTE_COLORS = [
  { name: 'Yellow', hex: '#f4d35e' },
  { name: 'Red', hex: '#e06060' },
  { name: 'Blue', hex: '#6fa8dc' },
  { name: 'Green', hex: '#6abf69' },
  { name: 'Orange', hex: '#e89b4f' },
  { name: 'Purple', hex: '#b58ee0' },
] as const;

export type NoteColor = typeof NOTE_COLORS[number]['name'];

export interface NoteInfo {
  id: string;
  content: string;
  /** Anchored text snippet the note is attached to */
  anchorText: string;
  /** Element type where the note is anchored */
  elementType: string;
  /** Contextual label — e.g. character name, scene heading text */
  contextLabel: string;
  /** Note color for categorization */
  color: NoteColor;
  createdAt: string;
  /** Optional scene context */
  sceneId: string | null;
}

/** Filter state that can be set externally (e.g. from context menu) */
export interface NoteFilter {
  elementType: string | null;
  contextLabel: string | null;
  color: NoteColor | null;
  /** If set, show only this specific note */
  noteId: string | null;
}

/** A general note attached to the screenplay file (not anchored to any text) */
export interface GeneralNote {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  createdAt: string;
}

// ── Production Tagging (Final Draft TagData) ──

export interface TagCategory {
  id: string;
  name: string;
  color: string;
  isBuiltIn: boolean;
}

export interface TagItem {
  id: string;
  categoryId: string;
  /** Entity name — the reusable label for this tag (e.g. "Protagonist Residence"). */
  name: string;
  /** Original highlighted text (kept for backward compat). */
  text: string;
  /** Detailed notes/information about this tagged entity. */
  notes: string;
  sceneId: string | null;
  elementType: string;
  createdAt: string;
}

export const DEFAULT_TAG_CATEGORIES: TagCategory[] = [
  { id: 'cast', name: 'Cast', color: '#e06060', isBuiltIn: true },
  { id: 'extras', name: 'Extras', color: '#c0392b', isBuiltIn: true },
  { id: 'stunts', name: 'Stunts', color: '#e74c3c', isBuiltIn: true },
  { id: 'vehicles', name: 'Vehicles', color: '#e06c9f', isBuiltIn: true },
  { id: 'props', name: 'Props', color: '#9370DB', isBuiltIn: true },
  { id: 'special-effects', name: 'Special Effects', color: '#5dade2', isBuiltIn: true },
  { id: 'costumes', name: 'Costumes', color: '#1abc9c', isBuiltIn: true },
  { id: 'makeup', name: 'Makeup/Hair', color: '#45b39d', isBuiltIn: true },
  { id: 'animals', name: 'Animals', color: '#6abf69', isBuiltIn: true },
  { id: 'animal-handler', name: 'Animal Handler', color: '#27ae60', isBuiltIn: true },
  { id: 'music', name: 'Music', color: '#f4d35e', isBuiltIn: true },
  { id: 'sound', name: 'Sound', color: '#f0b429', isBuiltIn: true },
  { id: 'set-dressing', name: 'Set Dressing', color: '#d4a373', isBuiltIn: true },
  { id: 'greenery', name: 'Greenery', color: '#2ecc71', isBuiltIn: true },
  { id: 'special-equipment', name: 'Special Equipment', color: '#8e44ad', isBuiltIn: true },
  { id: 'security', name: 'Security', color: '#7f8c8d', isBuiltIn: true },
  { id: 'additional-labor', name: 'Additional Labor', color: '#95a5a6', isBuiltIn: true },
  { id: 'vfx', name: 'Visual Effects', color: '#3498db', isBuiltIn: true },
  { id: 'optical-fx', name: 'Optical FX', color: '#ADD8E6', isBuiltIn: true },
  { id: 'mechanical-fx', name: 'Mechanical FX', color: '#4169E1', isBuiltIn: true },
];

export interface CharacterProfile {
  /** Uppercase canonical character name */
  name: string;
  /** Rich text description / bio (HTML string; maps to FDX CastMember Description as plain text) */
  description: string;
  /** Highlight color hex (Final Draft CharacterHighlighting) */
  color: string;
  /** Whether highlighting is enabled for this character */
  highlighted: boolean;
  /** Structured metadata (Final Draft Character Navigator fields) */
  gender: string;
  age: string;
  /** Role in the story: Lead, Supporting, Featured, Background, Day Player */
  role: string;
  /** Rich text backstory / character history (HTML string; OpenDraft-only, not in FDX) */
  backstory: string;
  /** Asset IDs of images associated with this character */
  images: string[];
}

export interface BeatColumn {
  id: string;
  title: string;
  position: number;
  width: number; // pixels, 0 = auto/fill
}

export interface BeatLinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export interface BeatInfo {
  id: string;
  title: string;
  description: string;
  columnId: string;
  position: number;
  color: string;
  imageUrl: string;
  cardWidth: number;   // pixels, 0 = fill column
  cardHeight: number;  // pixels, 0 = auto
  x: number;           // custom-arrange: absolute X position on canvas
  y: number;           // custom-arrange: absolute Y position on canvas
  imageHeight: number; // pixels, 0 = default (140px)
  linkPreviews?: BeatLinkPreview[]; // cached link preview metadata
}

export type BeatArrangeMode = 'auto' | 'custom';

interface EditorState {
  // Current element type
  activeElement: ElementType;
  setActiveElement: (el: ElementType) => void;

  // Document info
  documentTitle: string;
  setDocumentTitle: (title: string) => void;
  pageCount: number;
  setPageCount: (count: number) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;

  // Scene navigator
  scenes: SceneInfo[];
  setScenes: (scenes: SceneInfo[]) => void;
  navigatorOpen: boolean;
  toggleNavigator: () => void;

  // Panels
  indexCardsOpen: boolean;
  toggleIndexCards: () => void;
  beatBoardOpen: boolean;
  toggleBeatBoard: () => void;
  scriptNotesOpen: boolean;
  toggleScriptNotes: () => void;
  notesActiveTab: 'script' | 'general';
  setNotesActiveTab: (tab: 'script' | 'general') => void;
  notesVisible: boolean;
  setNotesVisible: (v: boolean) => void;

  // Scene synopsis
  updateSceneSynopsis: (id: string, synopsis: string) => void;

  // Notes
  notes: NoteInfo[];
  setNotes: (notes: NoteInfo[]) => void;
  addNote: (note: Omit<NoteInfo, 'id' | 'createdAt'>) => string;
  updateNote: (id: string, updates: Partial<Pick<NoteInfo, 'content' | 'color'>>) => void;
  deleteNote: (id: string) => void;
  noteFilter: NoteFilter;
  setNoteFilter: (filter: NoteFilter) => void;

  // General notes (file-level, not anchored to text)
  generalNotes: GeneralNote[];
  setGeneralNotes: (notes: GeneralNote[]) => void;
  addGeneralNote: (note: Omit<GeneralNote, 'id' | 'createdAt'>) => string;
  updateGeneralNote: (id: string, updates: Partial<Pick<GeneralNote, 'title' | 'content' | 'color'>>) => void;
  deleteGeneralNote: (id: string) => void;

  // Beats
  beatArrangeMode: BeatArrangeMode;
  setBeatArrangeMode: (mode: BeatArrangeMode) => void;
  beatColumns: BeatColumn[];
  setBeatColumns: (columns: BeatColumn[]) => void;
  addBeatColumn: (title: string) => string;
  updateBeatColumn: (id: string, updates: Partial<{ title: string; position: number; width: number }>) => void;
  deleteBeatColumn: (id: string) => void;
  beats: BeatInfo[];
  setBeats: (beats: BeatInfo[]) => void;
  addBeat: (title: string, columnId: string) => void;
  updateBeat: (id: string, updates: Partial<{ title: string; description: string; columnId: string; position: number; color: string; imageUrl: string; cardWidth: number; cardHeight: number; x: number; y: number; imageHeight: number }>) => void;
  deleteBeat: (id: string) => void;
  // Beat undo/redo
  beatUndo: () => void;
  beatRedo: () => void;
  canBeatUndo: boolean;
  canBeatRedo: boolean;
  _beatUndoStack: { beats: BeatInfo[]; beatColumns: BeatColumn[] }[];
  _beatRedoStack: { beats: BeatInfo[]; beatColumns: BeatColumn[] }[];
  _beatSnapshotTime: number;
  _beatIsUndoing: boolean;

  // Scene numbering
  sceneNumbersVisible: boolean;
  setSceneNumbersVisible: (v: boolean) => void;
  sceneNumbersLocked: boolean;
  setSceneNumbersLocked: (v: boolean) => void;

  // Revision
  revisionMode: boolean;
  revisionColor: string;
  setRevisionMode: (on: boolean) => void;
  setRevisionColor: (color: string) => void;

  // Character profiles (Final Draft CastList + CharacterHighlighting)
  characters: string[];
  setCharacters: (names: string[]) => void;
  addCharacter: (name: string) => void;
  characterProfiles: CharacterProfile[];
  setCharacterProfiles: (profiles: CharacterProfile[]) => void;
  upsertCharacterProfile: (name: string, updates: Partial<Omit<CharacterProfile, 'name'>>) => void;
  deleteCharacterProfile: (name: string) => void;
  characterProfilesOpen: boolean;
  toggleCharacterProfiles: () => void;
  selectedCharacter: string | null;
  setSelectedCharacter: (name: string | null) => void;

  // Production tags
  tagCategories: TagCategory[];
  setTagCategories: (cats: TagCategory[]) => void;
  addTagCategory: (name: string, color: string) => string;
  deleteTagCategory: (id: string) => void;
  tags: TagItem[];
  setTags: (tags: TagItem[]) => void;
  addTag: (tag: Omit<TagItem, 'id' | 'createdAt' | 'name'> & { name?: string }) => string;
  updateTag: (id: string, updates: Partial<Pick<TagItem, 'notes' | 'categoryId' | 'name'>>) => void;
  deleteTag: (id: string) => void;
  tagsVisible: boolean;
  setTagsVisible: (v: boolean) => void;
  tagsPanelOpen: boolean;
  toggleTagsPanel: () => void;
  /** When set, the Tags panel shows a "select category" prompt for this selection */
  pendingTagSelection: { from: number; to: number; text: string; elementType: string; sceneId: string | null } | null;
  setPendingTagSelection: (sel: { from: number; to: number; text: string; elementType: string; sceneId: string | null } | null) => void;
  /** When set, the Tags panel auto-expands this tag for editing */
  editingTagId: string | null;
  setEditingTagId: (id: string | null) => void;

  // Zoom
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  zoomPanelOpen: boolean;
  setZoomPanelOpen: (open: boolean) => void;

  // Font
  fontFamily: string;
  setFontFamily: (font: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;

  // Page layout
  pageLayout: PageLayout;
  setPageLayout: (layout: PageLayout) => void;

  // Theme
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;

  // Toolbar display mode
  toolbarMode: 'compact' | 'comfortable' | 'hidden';
  setToolbarMode: (mode: 'compact' | 'comfortable' | 'hidden') => void;

  // Navigator panel width (for floating menu positioning)
  navPanelWidth: number;
  setNavPanelWidth: (w: number) => void;

  // Spell check
  spellCheckEnabled: boolean;
  toggleSpellCheck: () => void;

  // Track changes
  trackChangesEnabled: boolean;
  trackChangesLabel: string;
  setTrackChangesEnabled: (v: boolean) => void;
  setTrackChangesLabel: (v: string) => void;
  compareVersionOpen: boolean;
  setCompareVersionOpen: (v: boolean) => void;

  // Dialogs
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  goToPageOpen: boolean;
  setGoToPageOpen: (open: boolean) => void;
  openFromProjectOpen: boolean;
  setOpenFromProjectOpen: (open: boolean) => void;
  saveAsOpen: boolean;
  setSaveAsOpen: (open: boolean) => void;
  /** Optional callback to run after save-as completes (e.g. deferred import). */
  postSaveAction: (() => void) | null;
  setPostSaveAction: (action: (() => void) | null) => void;
}

const BEAT_UNDO_MAX = 50;
const BEAT_SNAPSHOT_DEBOUNCE = 300; // ms — group rapid changes into one undo step

/** Push current beat state onto the undo stack (debounced unless forced). */
function _pushBeatSnapshot(get: () => EditorState, force = false) {
  const s = get() as EditorState & { _beatIsUndoing: boolean; _beatUndoStack: unknown[]; _beatSnapshotTime: number };
  if (s._beatIsUndoing) {
    useEditorStore.setState({ _beatIsUndoing: false } as any);
    return;
  }
  const now = Date.now();
  if (!force && now - s._beatSnapshotTime < BEAT_SNAPSHOT_DEBOUNCE) return;
  const stack = [...(s._beatUndoStack as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[]), { beats: s.beats, beatColumns: s.beatColumns }];
  if (stack.length > BEAT_UNDO_MAX) stack.shift();
  useEditorStore.setState({ _beatUndoStack: stack, _beatRedoStack: [], _beatSnapshotTime: now, canBeatUndo: true, canBeatRedo: false } as any);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeElement: 'action',
  setActiveElement: (el) => set({ activeElement: el }),

  documentTitle: 'Untitled Screenplay',
  setDocumentTitle: (title) => set({ documentTitle: title }),
  pageCount: 1,
  setPageCount: (count) => set({ pageCount: count }),
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),

  scenes: [],
  setScenes: (scenes) => set({ scenes }),
  navigatorOpen: _vs.navigatorOpen ?? (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? false : true),
  toggleNavigator: () => set((s) => {
    const v = !s.navigatorOpen;
    saveViewState({ navigatorOpen: v });
    return { navigatorOpen: v };
  }),

  indexCardsOpen: _vs.indexCardsOpen ?? false,
  toggleIndexCards: () => set((s) => {
    const v = !s.indexCardsOpen;
    saveViewState({ indexCardsOpen: v });
    return { indexCardsOpen: v };
  }),
  beatBoardOpen: _vs.beatBoardOpen ?? false,
  toggleBeatBoard: () => set((s) => {
    const v = !s.beatBoardOpen;
    saveViewState({ beatBoardOpen: v });
    return { beatBoardOpen: v };
  }),
  scriptNotesOpen: _vs.scriptNotesOpen ?? false,
  toggleScriptNotes: () => set((s) => {
    const v = !s.scriptNotesOpen;
    saveViewState({ scriptNotesOpen: v });
    return { scriptNotesOpen: v };
  }),
  notesActiveTab: _vs.notesActiveTab ?? 'general',
  setNotesActiveTab: (tab) => {
    saveViewState({ notesActiveTab: tab });
    set({ notesActiveTab: tab });
  },
  notesVisible: _vs.notesVisible ?? false,
  setNotesVisible: (v) => {
    saveViewState({ notesVisible: v });
    set({ notesVisible: v });
  },

  updateSceneSynopsis: (id, synopsis) =>
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, synopsis } : sc)),
    })),

  // Notes
  notes: [],
  setNotes: (notes) => set({ notes }),
  addNote: (note) => {
    const id = uuid();
    set((s) => ({
      notes: [
        ...s.notes,
        {
          ...note,
          id,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    return id;
  },
  updateNote: (id, updates) =>
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  deleteNote: (id) =>
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  noteFilter: { elementType: null, contextLabel: null, color: null, noteId: null },
  setNoteFilter: (filter) => set({ noteFilter: filter }),

  // General notes
  generalNotes: [],
  setGeneralNotes: (generalNotes) => set({ generalNotes }),
  addGeneralNote: (note) => {
    const id = uuid();
    set((s) => ({
      generalNotes: [
        ...s.generalNotes,
        { ...note, id, createdAt: new Date().toISOString() },
      ],
    }));
    return id;
  },
  updateGeneralNote: (id, updates) =>
    set((s) => ({
      generalNotes: s.generalNotes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  deleteGeneralNote: (id) =>
    set((s) => ({ generalNotes: s.generalNotes.filter((n) => n.id !== id) })),

  // Beats — undo/redo internals (not serialized)
  _beatUndoStack: [] as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[],
  _beatRedoStack: [] as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[],
  _beatSnapshotTime: 0,
  _beatIsUndoing: false,
  canBeatUndo: false,
  canBeatRedo: false,
  beatUndo: () =>
    set((s) => {
      const stack = s._beatUndoStack as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[];
      if (stack.length === 0) return {};
      const prev = stack[stack.length - 1];
      const redo = [...(s._beatRedoStack as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[]), { beats: s.beats, beatColumns: s.beatColumns }];
      return {
        beats: prev.beats,
        beatColumns: prev.beatColumns,
        _beatUndoStack: stack.slice(0, -1),
        _beatRedoStack: redo,
        _beatIsUndoing: true,
        canBeatUndo: stack.length > 1,
        canBeatRedo: true,
      };
    }),
  beatRedo: () =>
    set((s) => {
      const stack = s._beatRedoStack as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[];
      if (stack.length === 0) return {};
      const next = stack[stack.length - 1];
      const undo = [...(s._beatUndoStack as { beats: BeatInfo[]; beatColumns: BeatColumn[] }[]), { beats: s.beats, beatColumns: s.beatColumns }];
      return {
        beats: next.beats,
        beatColumns: next.beatColumns,
        _beatUndoStack: undo,
        _beatRedoStack: stack.slice(0, -1),
        _beatIsUndoing: true,
        canBeatUndo: true,
        canBeatRedo: stack.length > 1,
      };
    }),

  // Beats
  beatArrangeMode: 'auto',
  setBeatArrangeMode: (mode) => set({ beatArrangeMode: mode }),
  beatColumns: [],
  setBeatColumns: (columns) => set({ beatColumns: columns }),
  addBeatColumn: (title) => {
    const id = uuid();
    _pushBeatSnapshot(get);
    set((s) => {
      const maxPos = s.beatColumns.length > 0 ? Math.max(...s.beatColumns.map((c) => c.position)) : -1;
      return { beatColumns: [...s.beatColumns, { id, title, position: maxPos + 1, width: 0 }] };
    });
    return id;
  },
  updateBeatColumn: (id, updates) => {
    _pushBeatSnapshot(get);
    set((s) => ({
      beatColumns: s.beatColumns.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  },
  deleteBeatColumn: (id) => {
    _pushBeatSnapshot(get, true);
    set((s) => ({
      beatColumns: s.beatColumns.filter((c) => c.id !== id),
      beats: s.beats.filter((b) => b.columnId !== id),
    }));
  },
  beats: [],
  setBeats: (beats) => {
    _pushBeatSnapshot(get);
    set({ beats });
  },
  addBeat: (title, columnId) => {
    _pushBeatSnapshot(get, true);
    set((s) => {
      const colBeats = s.beats.filter((b) => b.columnId === columnId);
      const maxPos = colBeats.length > 0 ? Math.max(...colBeats.map((b) => b.position)) : -1;
      return {
        beats: [
          ...s.beats,
          {
            id: uuid(),
            title,
            description: '',
            columnId,
            position: maxPos + 1,
            color: '',
            imageUrl: '',
            cardWidth: 0,
            cardHeight: 0,
            x: 0,
            y: 0,
            imageHeight: 0,
          },
        ],
      };
    });
  },
  updateBeat: (id, updates) => {
    _pushBeatSnapshot(get);
    set((s) => ({
      beats: s.beats.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    }));
  },
  deleteBeat: (id) => {
    _pushBeatSnapshot(get, true);
    set((s) => ({ beats: s.beats.filter((b) => b.id !== id) }));
  },

  // Scene numbering
  sceneNumbersVisible: false,
  setSceneNumbersVisible: (v) => set({ sceneNumbersVisible: v }),
  sceneNumbersLocked: false,
  setSceneNumbersLocked: (v) => set({ sceneNumbersLocked: v }),

  revisionMode: false,
  revisionColor: 'White',
  setRevisionMode: (on) => set({ revisionMode: on }),
  setRevisionColor: (color) => set({ revisionColor: color }),

  characters: [],
  setCharacters: (names) => set({ characters: names }),
  addCharacter: (name) =>
    set((s) => ({
      characters: s.characters.includes(name.toUpperCase())
        ? s.characters
        : [...s.characters, name.toUpperCase()],
    })),
  characterProfiles: [],
  setCharacterProfiles: (profiles) => set({ characterProfiles: profiles }),
  upsertCharacterProfile: (name, updates) =>
    set((s) => {
      const upper = name.toUpperCase();
      const idx = s.characterProfiles.findIndex((p) => p.name === upper);
      if (idx >= 0) {
        const copy = [...s.characterProfiles];
        copy[idx] = { ...copy[idx], ...updates };
        return { characterProfiles: copy };
      }
      return {
        characterProfiles: [
          ...s.characterProfiles,
          {
            name: upper,
            description: '',
            color: '',
            highlighted: false,
            gender: '',
            age: '',
            role: '',
            backstory: '',
            images: [],
            ...updates,
          },
        ],
      };
    }),
  deleteCharacterProfile: (name) =>
    set((s) => ({
      characterProfiles: s.characterProfiles.filter((p) => p.name !== name.toUpperCase()),
    })),
  characterProfilesOpen: _vs.characterProfilesOpen ?? false,
  toggleCharacterProfiles: () => set((s) => {
    const v = !s.characterProfilesOpen;
    saveViewState({ characterProfilesOpen: v });
    return { characterProfilesOpen: v };
  }),
  selectedCharacter: null,
  setSelectedCharacter: (name) => set({ selectedCharacter: name }),

  // Production tags
  tagCategories: [...DEFAULT_TAG_CATEGORIES],
  setTagCategories: (cats) => set({ tagCategories: cats }),
  addTagCategory: (name, color) => {
    const id = uuid();
    set((s) => ({
      tagCategories: [...s.tagCategories, { id, name, color, isBuiltIn: false }],
    }));
    return id;
  },
  deleteTagCategory: (id) =>
    set((s) => ({
      tagCategories: s.tagCategories.filter((c) => c.id !== id),
      tags: s.tags.filter((t) => t.categoryId !== id),
    })),
  tags: [],
  setTags: (tags) => set({ tags }),
  addTag: (tag) => {
    const id = uuid();
    set((s) => ({
      tags: [...s.tags, { ...tag, name: tag.name || tag.text, id, createdAt: new Date().toISOString() }],
    }));
    return id;
  },
  updateTag: (id, updates) =>
    set((s) => ({
      tags: s.tags.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  deleteTag: (id) =>
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) })),
  tagsVisible: _vs.tagsVisible ?? false,
  setTagsVisible: (v) => {
    saveViewState({ tagsVisible: v });
    set({ tagsVisible: v });
  },
  tagsPanelOpen: _vs.tagsPanelOpen ?? false,
  toggleTagsPanel: () => set((s) => {
    const v = !s.tagsPanelOpen;
    saveViewState({ tagsPanelOpen: v });
    return { tagsPanelOpen: v };
  }),
  pendingTagSelection: null,
  setPendingTagSelection: (sel) => set({ pendingTagSelection: sel }),
  editingTagId: null,
  setEditingTagId: (id) => set({ editingTagId: id }),

  zoomLevel: _vs.zoomLevel ?? 100,
  setZoomLevel: (level) => { const clamped = Math.min(200, Math.max(50, level)); set({ zoomLevel: clamped }); saveViewState({ zoomLevel: clamped }); },
  zoomPanelOpen: false,
  setZoomPanelOpen: (open) => set({ zoomPanelOpen: open }),

  fontFamily: 'Courier Prime',
  setFontFamily: (font) => set({ fontFamily: font }),
  fontSize: 12,
  setFontSize: (size) => set({ fontSize: Math.min(24, Math.max(8, size)) }),

  pageLayout: DEFAULT_PAGE_LAYOUT,
  setPageLayout: (layout) => set({ pageLayout: layout }),

  theme: (localStorage.getItem('opendraft:theme') as 'dark' | 'light') || 'dark',
  setTheme: (t) => {
    localStorage.setItem('opendraft:theme', t);
    document.documentElement.setAttribute('data-theme', t);
    set({ theme: t });
  },

  toolbarMode: (_vs.toolbarMode as 'compact' | 'comfortable' | 'hidden') ?? 'compact',
  setToolbarMode: (mode) => { set({ toolbarMode: mode }); saveViewState({ toolbarMode: mode }); },

  navPanelWidth: 0,
  setNavPanelWidth: (w) => set({ navPanelWidth: w }),

  spellCheckEnabled: false,
  toggleSpellCheck: () => set((s) => ({ spellCheckEnabled: !s.spellCheckEnabled })),

  trackChangesEnabled: false,
  trackChangesLabel: '',
  setTrackChangesEnabled: (v) => set({ trackChangesEnabled: v }),
  setTrackChangesLabel: (v) => set({ trackChangesLabel: v }),
  compareVersionOpen: false,
  setCompareVersionOpen: (v) => set({ compareVersionOpen: v }),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  goToPageOpen: false,
  setGoToPageOpen: (open) => set({ goToPageOpen: open }),
  openFromProjectOpen: false,
  setOpenFromProjectOpen: (open) => set({ openFromProjectOpen: open }),
  saveAsOpen: false,
  setSaveAsOpen: (open) => set({ saveAsOpen: open }),
  postSaveAction: null,
  setPostSaveAction: (action) => set({ postSaveAction: action }),
}));
