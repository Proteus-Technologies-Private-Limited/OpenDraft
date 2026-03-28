import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import History from '@tiptap/extension-history';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { Extension } from '@tiptap/core';

import {
  SceneHeading, Action, Character, Dialogue, Parenthetical,
  Transition, General, Shot, NewAct, EndOfAct, Lyrics,
  ShowEpisode, CastList, FontSize, ScriptNoteMark, TagMark,
} from '../editor/extensions';
import { createPaginationPlugin, getPageMetrics } from '../editor/pagination';

import { useEditorStore } from '../stores/editorStore';
import type { ElementType } from '../stores/editorStore';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';
import SceneNavigator from './SceneNavigator';
import IndexCards from './IndexCards';
import BeatBoard from './BeatBoard';
import ScriptNotes from './ScriptNotes';
import CharacterProfiles from './CharacterProfiles';
import TagsPanel from './TagsPanel';
import FormatPanel from './FormatPanel';
import StatusBar from './StatusBar';
import SearchReplace, { createSearchPlugin } from './SearchReplace';
import GoToPage from './GoToPage';
import ElementPicker from './ElementPicker';
import CharacterAutocomplete from './CharacterAutocomplete';
import SpellCheckModal from './SpellCheckModal';
import ScriptContextMenu from './ScriptContextMenu';
import { SpellCheck, spellCheckPluginKey } from '../editor/extensions/SpellCheck';
import { spellChecker } from '../editor/spellchecker';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { API_BASE } from '../config';
import { showToast } from './Toast';
import VersionHistory from './VersionHistory';
import AssetManager from './AssetManager';
import { useParams } from 'react-router-dom';
import OpenFromProject from './OpenFromProject';
import WelcomeDialog from './WelcomeDialog';
import SaveAsDialog from './SaveAsDialog';

// Default next element type when pressing Enter
const DEFAULT_NEXT_TYPE: Record<string, string> = {
  sceneHeading: 'action',
  action: 'action',
  character: 'dialogue',
  dialogue: 'dialogue',
  parenthetical: 'dialogue',
  transition: 'sceneHeading',
  general: 'general',
  shot: 'action',
  newAct: 'sceneHeading',
  endOfAct: 'newAct',
  lyrics: 'lyrics',
  showEpisode: 'action',
  castList: 'castList',
};

const ALL_ELEMENT_TYPES: ElementType[] = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical',
  'transition', 'general', 'shot', 'newAct', 'endOfAct', 'lyrics',
  'showEpisode', 'castList',
];

const SAMPLE_CONTENT = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. COFFEE SHOP - DAY' }] },
    { type: 'action', content: [{ type: 'text', text: 'A busy coffee shop in downtown Los Angeles. Patrons sit at small tables, laptops open, headphones on. The hiss of the espresso machine punctuates the low murmur of conversation. A BARISTA calls out orders while steam curls from ceramic cups.' }] },
    { type: 'action', content: [{ type: 'text', text: 'SARAH CHEN (30s, sharp eyes, worn leather jacket) sits alone at a corner table, nursing a cold coffee. She stares at her phone, waiting. Her leg bounces under the table — the only outward sign of the tension coiled inside her.' }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(under her breath)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Come on... pick up.' }] },
    { type: 'action', content: [{ type: 'text', text: 'The door SWINGS open. MARCUS WEBB (40s, rumpled suit, easy smile that hides something harder) enters, shaking rain off his umbrella. He spots Sarah and heads her way, weaving between tables with practiced ease.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MARCUS' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'You know, most people just text when they want to meet.' }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "Most people aren't being followed." }] },
    { type: 'action', content: [{ type: 'text', text: "Marcus's smile fades. He sits down across from her, leaning in close. The ambient noise of the coffee shop seems to recede, leaving them in their own bubble of urgency." }] },
    { type: 'character', content: [{ type: 'text', text: 'MARCUS' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(low)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Tell me everything. From the beginning.' }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "Three weeks ago I found a file on Reeves' server. Something called NIGHTFALL. It had names, dates, bank accounts — everything. The next day, my access was revoked and someone broke into my apartment." }] },
    { type: 'character', content: [{ type: 'text', text: 'MARCUS' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Did you make a copy?' }] },
    { type: 'action', content: [{ type: 'text', text: 'Sarah reaches into her jacket and slides a USB drive across the table. Marcus stares at it like it might explode.' }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "That's the only copy. Guard it with your life. I mean that literally." }] },
    { type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] },
    { type: 'sceneHeading', content: [{ type: 'text', text: 'EXT. CITY STREET - NIGHT' }] },
    { type: 'action', content: [{ type: 'text', text: 'Rain slicks the pavement, reflecting neon signs in shattered patterns. Sarah walks quickly, collar up, glancing over her shoulder every few steps. The city feels hostile — every shadow a threat, every passing car a potential tail.' }] },
    { type: 'action', content: [{ type: 'text', text: 'She turns down an alley. Stops. Listens. Nothing but the patter of rain on dumpsters and the distant wail of a siren. She exhales, allows herself a moment of relief.' }] },
    { type: 'action', content: [{ type: 'text', text: 'Then: FOOTSTEPS. Behind her. Measured. Deliberate.' }] },
    { type: 'action', content: [{ type: 'text', text: "Sarah doesn't run. She turns slowly, hands loose at her sides, ready." }] },
    { type: 'action', content: [{ type: 'text', text: 'A FIGURE emerges from the shadows. Tall, broad-shouldered, face hidden under a dark hood. He stops ten feet away.' }] },
    { type: 'character', content: [{ type: 'text', text: 'HOODED FIGURE' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "You should have left it alone, Sarah." }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "I tried. Your boss wouldn't let me." }] },
    { type: 'action', content: [{ type: 'text', text: 'The figure takes a step forward. Sarah holds her ground. Rain streams down her face, but her eyes are steady, defiant.' }] },
    { type: 'character', content: [{ type: 'text', text: 'HOODED FIGURE' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "Give me the drive and you walk away. That's the deal. Only deal you're going to get." }] },
    { type: 'character', content: [{ type: 'text', text: 'SARAH' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(smiling)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "I don't have it anymore." }] },
    { type: 'action', content: [{ type: 'text', text: "The figure's posture shifts. Anger, barely contained." }] },
    { type: 'character', content: [{ type: 'text', text: 'HOODED FIGURE' }] },
    { type: 'dialogue', content: [{ type: 'text', text: "Then we have a problem." }] },
    { type: 'transition', content: [{ type: 'text', text: 'SMASH CUT TO:' }] },
    { type: 'sceneHeading', content: [{ type: 'text', text: "INT. MARCUS' APARTMENT - NIGHT" }] },
    { type: 'action', content: [{ type: 'text', text: "A small, cluttered studio. Stacks of newspapers, half-eaten takeout containers, a wall covered in pinned photos and red string. Marcus sits at his desk, the USB drive plugged into his laptop." }] },
    { type: 'action', content: [{ type: 'text', text: 'His eyes widen as he scrolls through the files. Page after page of financial records, offshore accounts, wire transfers. Names he recognizes — senators, CEOs, a Supreme Court justice.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MARCUS' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(whispered)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Holy shit.' }] },
    { type: 'action', content: [{ type: 'text', text: 'His phone BUZZES. A text from an unknown number: "CHECK YOUR DOOR."' }] },
    { type: 'action', content: [{ type: 'text', text: 'Marcus freezes. Slowly turns toward his front door. Through the peephole: nothing but the empty hallway. But on his doormat — a manila envelope.' }] },
    { type: 'action', content: [{ type: 'text', text: 'He opens it with trembling hands. Inside: a single photograph of Sarah, taken from above, a red X drawn across her face.' }] },
    { type: 'action', content: [{ type: 'text', text: 'Marcus grabs his phone, dials Sarah. It rings. And rings. And rings.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MARCUS' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(into phone, desperate)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Pick up, Sarah. Pick up...' }] },
    { type: 'action', content: [{ type: 'text', text: 'No answer. Marcus stares at the photograph, then at the laptop screen full of secrets. He makes a decision.' }] },
    { type: 'action', content: [{ type: 'text', text: 'He copies the files to a second drive, tapes it under his desk drawer, grabs his coat and the original drive, and heads for the door.' }] },
    { type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] },
    { type: 'sceneHeading', content: [{ type: 'text', text: 'EXT. CITY STREET - CONTINUOUS' }] },
    { type: 'action', content: [{ type: 'text', text: 'Marcus bursts out of his building into the rain. He looks left, right — the street is deserted. He starts walking fast, then running.' }] },
    { type: 'action', content: [{ type: 'text', text: 'Behind him, a black sedan pulls away from the curb. Its headlights stay off.' }] },
  ],
};

interface OverlayInfo {
  top: number;
  pageNumber: number;
  isDialogueSplit: boolean;
  characterName: string;
}

const ScreenplayEditor: React.FC = () => {
  const { projectId: urlProjectId, scriptId: urlScriptId } = useParams<{ projectId?: string; scriptId?: string }>();

  const {
    setActiveElement, setScenes, setPageCount, setCurrentPage,
    zoomLevel, fontFamily, fontSize, pageLayout, tagsVisible, notesVisible,
    beatBoardOpen,
    spellCheckEnabled, setDocumentTitle,
  } = useEditorStore();

  const { currentProject, currentScriptId, setCurrentProject, setCurrentScriptId } = useProjectStore();

  const editorMainRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const setPageCountRef = useRef(setPageCount);
  setPageCountRef.current = setPageCount;
  const pageLayoutRef = useRef(pageLayout);
  pageLayoutRef.current = pageLayout;

  const [overlays, setOverlays] = useState<OverlayInfo[]>([]);

  const { openFromProjectOpen, setOpenFromProjectOpen, saveAsOpen, setSaveAsOpen } = useEditorStore();

  // Welcome dialog — show on first visit
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('opendraft:welcomed') && !urlScriptId;
  });

  // Element picker state
  const [pickerState, setPickerState] = useState<{
    visible: boolean;
    position: { top: number; left: number };
    defaultType: ElementType;
  }>({ visible: false, position: { top: 0, left: 0 }, defaultType: 'action' });

  const showPickerRef = useRef<(defaultType: ElementType) => void>(() => {});

  // Character autocomplete state
  const [knownCharacters, setKnownCharacters] = useState<string[]>([]);
  const [charAutoState, setCharAutoState] = useState<{
    visible: boolean;
    position: { top: number; left: number };
    suggestions: string[];
  }>({ visible: false, position: { top: 0, left: 0 }, suggestions: [] });
  const charAutoDismissedRef = useRef(false);

  // Spell check modal state
  const [spellModalOpen, setSpellModalOpen] = useState(false);
  const [formatPanelOpen, setFormatPanelOpen] = useState(false);

  // Script context menu state
  const [ctxMenuState, setCtxMenuState] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    spellInfo: { word: string; from: number; to: number; suggestions: string[] } | null;
  }>({ visible: false, position: { x: 0, y: 0 }, spellInfo: null });

  const breaksRef = useRef<import('../editor/pagination').BreakInfo[]>([]);

  // Measure overlay positions from the actual DOM after decorations are applied
  const measureOverlays = useCallback(() => {
    if (!pageRef.current) return;
    const pageEl = pageRef.current;
    const root = pageEl.querySelector('.tiptap');
    if (!root) return;

    const pageRect = pageEl.getBoundingClientRect();
    const m = getPageMetrics(pageLayoutRef.current);
    const children = Array.from(root.children) as HTMLElement[];
    const breaks = breaksRef.current;
    if (breaks.length === 0) { setOverlays([]); return; }

    const lineHeightPx = 12 * (96 / 72); // 16px — matches pagination LINE_HEIGHT_PT
    const newOverlays: OverlayInfo[] = [];
    for (const brk of breaks) {
      const el = children[brk.nodeIndex];
      if (!el) continue;
      // The element has Decoration.node margin-top = whitespace + sepHeight + contdHeight
      // The overlay goes just above the element, occupying sepHeight + contdHeight
      const elRect = el.getBoundingClientRect();
      const contdHeight = brk.isDialogueSplit ? lineHeightPx : 0;
      const overlayTop = elRect.top - pageRect.top - m.sepHeightPx - contdHeight;
      newOverlays.push({
        top: overlayTop,
        pageNumber: brk.pageNumber,
        isDialogueSplit: brk.isDialogueSplit,
        characterName: brk.characterName,
      });
    }
    setOverlays(newOverlays);
  }, []);

  const [PaginationExtension] = React.useState(() =>
    Extension.create({
      name: 'pagination',
      addProseMirrorPlugins() {
        return [
          createPaginationPlugin(
            (state) => {
              setPageCountRef.current(state.pageCount);
              breaksRef.current = state.breaks;
              // Measure from DOM after ProseMirror applies decoration margins
              requestAnimationFrame(() => requestAnimationFrame(measureOverlays));
            },
            () => pageLayoutRef.current,
          ),
        ];
      },
    })
  );

  // Search highlight plugin
  const [SearchExtension] = React.useState(() =>
    Extension.create({
      name: 'searchHighlight',
      addProseMirrorPlugins() {
        return [createSearchPlugin()];
      },
    })
  );

  // Centralized Enter handler — overrides per-extension Enter handlers via high priority
  const [EnterHandlerExtension] = React.useState(() =>
    Extension.create({
      name: 'enterHandler',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            const { $from } = editor.state.selection;
            const currentNode = $from.parent;
            const currentType = currentNode.type.name;
            const isEmpty = currentNode.textContent.trim() === '';

            // Blank line: show element picker (keep current block as-is)
            if (isEmpty) {
              showPickerRef.current(currentType as ElementType);
              return true;
            }

            // Non-empty line: split block, then fix up both halves' types
            const nextType = DEFAULT_NEXT_TYPE[currentType] || currentType;
            editor.chain().splitBlock().run();

            // After split, cursor is in the new (second) block.
            // Fix its type, and ensure the first block kept original type.
            const { tr, schema, selection } = editor.state;
            const pos = selection.$from;
            const newBlockStart = pos.before(pos.depth);
            const newNodeType = schema.nodes[nextType];
            if (newNodeType && tr.doc.nodeAt(newBlockStart)?.type.name !== nextType) {
              tr.setNodeMarkup(newBlockStart, newNodeType);
            }
            // Also fix the first block (the one above) if it got changed
            const prevResolved = tr.doc.resolve(newBlockStart - 1);
            const prevBlockStart = prevResolved.before(prevResolved.depth);
            const origNodeType = schema.nodes[currentType];
            if (origNodeType && tr.doc.nodeAt(prevBlockStart)?.type.name !== currentType) {
              tr.setNodeMarkup(prevBlockStart, origNodeType);
            }
            if (tr.steps.length > 0) {
              editor.view.dispatch(tr);
            }
            return true;
          },
        };
      },
    })
  );

  const editor = useEditor({
    extensions: [
      Document.extend({
        content: 'block+',
      }),
      Text, Bold, Italic, Underline, History, Dropcursor, Gapcursor,
      TextStyle, Color, FontFamily, FontSize,
      TextAlign.configure({ types: ALL_ELEMENT_TYPES }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          const m: Record<string, string> = {
            sceneHeading: 'INT./EXT. LOCATION - TIME', action: 'Describe what happens...',
            character: 'CHARACTER NAME', dialogue: 'Dialogue...',
            parenthetical: '(direction)', transition: 'CUT TO:',
            general: 'Text...', shot: 'SHOT DESCRIPTION',
            newAct: 'ACT ONE', endOfAct: 'END OF ACT',
            lyrics: 'Lyrics...', showEpisode: 'SHOW TITLE', castList: 'Cast...',
          };
          return m[node.type.name] || '';
        },
      }),
      SceneHeading, Action, Character, Dialogue, Parenthetical,
      Transition, General, Shot, NewAct, EndOfAct, Lyrics,
      ShowEpisode, CastList, ScriptNoteMark, TagMark,
      PaginationExtension,
      SearchExtension,
      EnterHandlerExtension,
      SpellCheck,
    ],
    content: urlScriptId ? undefined : SAMPLE_CONTENT,
    editorProps: {
      attributes: { class: 'screenplay-content', spellcheck: 'true' },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      for (const type of ALL_ELEMENT_TYPES) {
        if (ed.isActive(type)) { setActiveElement(type); break; }
      }
    },
  });

  // --- Scene navigator ---
  const updateScenes = useCallback(() => {
    if (!editor) return;
    const list: { id: string; heading: string; sceneNumber: number | null; color: string; synopsis: string }[] = [];
    let idx = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'sceneHeading') {
        list.push({ id: `scene-${idx}`, heading: node.textContent || 'Untitled Scene', sceneNumber: idx + 1, color: '#4a9eff', synopsis: '' });
        idx++;
      }
      return true;
    });
    setScenes(list);
  }, [editor, setScenes]);

  useEffect(() => {
    if (!editor) return;
    updateScenes();
    editor.on('update', updateScenes);
    return () => { editor.off('update', updateScenes); };
  }, [editor, updateScenes]);

  // --- Collect character names from document (strip extensions like CONT'D, V.O., O.S.) ---
  const stripCharacterExtension = useCallback((raw: string): string => {
    // Remove all parenthetical extensions from character names
    // Handles: (CONT'D), (CONT'D), (CONTD), (V.O.), (V/O), (O.S.), (O.C.), (MORE)
    return raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
  }, []);

  const { setCharacters } = useEditorStore();

  const updateCharacters = useCallback(() => {
    if (!editor) return;
    const names = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'character') {
        const raw = node.textContent.trim().toUpperCase();
        const base = stripCharacterExtension(raw);
        if (base) names.add(base);
      }
      return true;
    });
    const sorted = Array.from(names).sort();
    setKnownCharacters(sorted);
    setCharacters(sorted);
  }, [editor, stripCharacterExtension, setCharacters]);

  useEffect(() => {
    if (!editor) return;
    updateCharacters();
    editor.on('update', updateCharacters);
    return () => { editor.off('update', updateCharacters); };
  }, [editor, updateCharacters]);

  // --- Auto CONT'D: add/remove (CONT'D) based on previous dialogue ---
  useEffect(() => {
    if (!editor) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const updateContd = () => {
      const { doc } = editor.state;

      // First pass: collect all children and determine what each character node should be
      const children: { type: string; text: string; pos: number }[] = [];
      doc.forEach((node, offset) => {
        children.push({ type: node.type.name, text: node.textContent, pos: offset });
      });

      // Determine CONT'D status for each character node
      interface ContdChange { pos: number; oldText: string; newText: string }
      const changes: ContdChange[] = [];
      let lastCharBase: string | null = null;
      let lastWasDialogue = false;

      for (const child of children) {
        if (child.type === 'character') {
          const raw = child.text.trim().toUpperCase();
          const base = stripCharacterExtension(raw);
          const hasContd = /\(CONT'D\)|\(CONT'D\)|\(CONTD\)/i.test(raw);
          const shouldHaveContd = lastCharBase !== null && base === lastCharBase && !lastWasDialogue;

          if (shouldHaveContd && !hasContd && base) {
            changes.push({ pos: child.pos, oldText: child.text, newText: `${base} (CONT'D)` });
          } else if (!shouldHaveContd && hasContd) {
            changes.push({ pos: child.pos, oldText: child.text, newText: base });
          }

          lastCharBase = base;
          lastWasDialogue = false;
        } else if (child.type === 'dialogue' || child.type === 'parenthetical') {
          lastWasDialogue = true;
        } else {
          lastWasDialogue = false;
        }
      }

      if (changes.length === 0) return;

      // Apply changes in reverse order so positions don't shift
      const { tr } = editor.state;
      for (let i = changes.length - 1; i >= 0; i--) {
        const c = changes[i];
        const from = c.pos + 1; // +1 for node open token
        const to = from + c.oldText.length;
        tr.insertText(c.newText, from, to);
      }
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    };

    const debouncedUpdate = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(updateContd, 800);
    };

    editor.on('update', debouncedUpdate);
    setTimeout(updateContd, 500);
    return () => {
      editor.off('update', debouncedUpdate);
      if (timeout) clearTimeout(timeout);
    };
  }, [editor, stripCharacterExtension]);

  // --- Character autocomplete: show/update on each editor update while in character block ---
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (!editor.isActive('character')) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        charAutoDismissedRef.current = false;
        return;
      }
      if (charAutoDismissedRef.current) return;

      const { $from } = editor.state.selection;
      const rawText = $from.parent.textContent.trim().toUpperCase();
      const text = stripCharacterExtension(rawText);
      if (!text) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        charAutoDismissedRef.current = false;
        return;
      }

      // Filter known characters that start with typed text (exclude exact match)
      // Only match against base names (without extensions)
      const matches = knownCharacters.filter(
        n => n.startsWith(text) && n !== text,
      );

      if (matches.length === 0) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        return;
      }

      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      setCharAutoState({
        visible: true,
        position: { top: coords.bottom + 4, left: coords.left },
        suggestions: matches,
      });
    };
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onUpdate);
    return () => { editor.off('update', onUpdate); editor.off('selectionUpdate', onUpdate); };
  }, [editor, knownCharacters]);

  // Re-measure overlays after editor updates (decorations settle)
  useEffect(() => {
    if (!editor) return;
    const run = () => requestAnimationFrame(() => requestAnimationFrame(measureOverlays));
    editor.on('update', run);
    // Initial measurement passes
    const timers = [200, 500, 1000].map(ms => setTimeout(run, ms));
    return () => { editor.off('update', run); timers.forEach(clearTimeout); };
  }, [editor, measureOverlays]);

  // Re-paginate when page layout changes (e.g., after FDX import)
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => {
      const { tr } = editor.state;
      tr.setMeta('forceRepaginate', true);
      editor.view.dispatch(tr);
    }, 300);
    return () => clearTimeout(t);
  }, [editor, pageLayout]);

  // --- Initialize spell checker on mount ---
  useEffect(() => {
    spellChecker.init();
  }, []);

  // --- Toggle spell check plugin when store changes ---
  useEffect(() => {
    if (!editor) return;
    const { tr } = editor.state;
    tr.setMeta(spellCheckPluginKey, { toggle: spellCheckEnabled });
    editor.view.dispatch(tr);
    // Open the spell check modal when enabled
    if (spellCheckEnabled) {
      setTimeout(() => setSpellModalOpen(true), 300);
    }
  }, [editor, spellCheckEnabled]);

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

  // --- Auto-save to backend every 30 seconds if a project/script is active ---
  const lastSavedJsonRef = useRef<string>('');
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const timer = setInterval(() => {
      const content = buildSaveContent();
      if (!content) return;
      const json = JSON.stringify(content);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        api.saveScript(currentProject.id, currentScriptId, { content }).catch((err) => {
          console.error('Auto-save failed:', err);
          showToast(`Auto-save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  // --- Save on page unload (refresh / close) ---
  // Uses keepalive fetch so the request completes even as the page unloads.
  // NOTE: We intentionally do NOT save on component unmount because the
  // editor may already be destroyed at that point, and editor.getJSON()
  // would return an empty doc, overwriting the saved file with blank content.
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const pid = currentProject.id;
    const sid = currentScriptId;
    const handleBeforeUnload = () => {
      if (editor.isDestroyed) return;
      const content = buildSaveContent();
      const json = JSON.stringify(content);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        fetch(`${API_BASE}/projects/${pid}/scripts/${sid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          keepalive: true,
        });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  // --- Load script from URL params ---
  // Reset the guard when the editor instance changes so we reload
  // content if TipTap recreates the editor.
  const loadedScriptRef = useRef<string | null>(null);
  useEffect(() => {
    if (editor) {
      loadedScriptRef.current = null; // allow re-load for new editor instance
    }
  }, [editor]);
  useEffect(() => {
    if (!editor || !urlProjectId || !urlScriptId) return;
    // Avoid reloading the same script
    if (loadedScriptRef.current === `${urlProjectId}/${urlScriptId}`) return;
    loadedScriptRef.current = `${urlProjectId}/${urlScriptId}`;
    (async () => {
      try {
        const project = await api.getProject(urlProjectId);
        setCurrentProject(project);
        setCurrentScriptId(urlScriptId);
        const scriptResp = await api.getScript(urlProjectId, urlScriptId);
        const content = scriptResp.content as Record<string, unknown> | null;

        // Strip app metadata keys before feeding to ProseMirror
        let pmDoc: Record<string, unknown> | null = null;
        if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
          const { _notes, _tags, _tagCategories, _characterProfiles, ...rest } = content as any;
          pmDoc = rest;
        }

        try {
          if (pmDoc && Array.isArray(pmDoc.content) && pmDoc.content.length > 0) {
            editor.commands.setContent(pmDoc);
          } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
            editor.commands.setContent(content);
          } else {
            editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
          }
        } catch (setErr) {
          console.error('setContent failed:', setErr);
          showToast(`Failed to render content: ${setErr instanceof Error ? setErr.message : String(setErr)}`, 'error');
          editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
        }

        // Restore metadata from top-level content keys
        const store = useEditorStore.getState();
        const parseAttr = (val: unknown): unknown[] => {
          if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
          if (Array.isArray(val)) return val;
          return [];
        };
        if (content) {
          const c = content as Record<string, unknown>;
          const notes = parseAttr(c._notes);
          if (notes.length > 0) store.setNotes(notes as import('../stores/editorStore').NoteInfo[]);
          const tagsArr = parseAttr(c._tags);
          if (tagsArr.length > 0) store.setTags(tagsArr as import('../stores/editorStore').TagItem[]);
          const tagCats = parseAttr(c._tagCategories);
          if (tagCats.length > 0) store.setTagCategories(tagCats as import('../stores/editorStore').TagCategory[]);
          const profiles = parseAttr(c._characterProfiles);
          if (profiles.length > 0) {
            for (const prof of profiles as Record<string, unknown>[]) {
              if (prof.name && typeof prof.name === 'string') {
                store.upsertCharacterProfile(prof.name, {
                  description: (prof.description as string) || '',
                  color: (prof.color as string) || '',
                  highlighted: (prof.highlighted as boolean) || false,
                  gender: (prof.gender as string) || '',
                  age: (prof.age as string) || '',
                });
              }
            }
          }
        }

        setDocumentTitle(scriptResp.meta.title);
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to load script:', err);
        showToast(`Failed to load script: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    })();
  }, [editor, urlProjectId, urlScriptId, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes]);

  // --- Sync orphaned marks: runs ONCE after editor is ready, not on every doc change ---
  const orphanSyncDone = useRef(false);
  useEffect(() => {
    if (!editor || orphanSyncDone.current) return;
    const timer = setTimeout(() => {
      orphanSyncDone.current = true;
      const store = useEditorStore.getState();
      const noteMarkType = editor.schema.marks.scriptNote;
      const tagMarkType = editor.schema.marks.productionTag;
      const noteIds = new Set(store.notes.map((n) => n.id));
      const tagIds = new Set(store.tags.map((t) => t.id));
      const orphanedNotes: { noteId: string; text: string; elementType: string }[] = [];
      const orphanedTags: { tagId: string; categoryId: string; color: string; text: string; elementType: string }[] = [];

      editor.state.doc.descendants((node) => {
        if (!node.isText) return;
        for (const mark of node.marks) {
          if (noteMarkType && mark.type === noteMarkType) {
            const id = mark.attrs.noteId as string;
            if (id && !noteIds.has(id)) {
              orphanedNotes.push({ noteId: id, text: node.textContent.slice(0, 80), elementType: 'action' });
              noteIds.add(id);
            }
          }
          if (tagMarkType && mark.type === tagMarkType) {
            const id = mark.attrs.tagId as string;
            if (id && !tagIds.has(id)) {
              orphanedTags.push({
                tagId: id,
                categoryId: (mark.attrs.categoryId as string) || 'props',
                color: (mark.attrs.color as string) || '#9370DB',
                text: node.textContent.slice(0, 80),
                elementType: 'action',
              });
              tagIds.add(id);
            }
          }
        }
      });

      if (orphanedNotes.length > 0) {
        store.setNotes([...store.notes, ...orphanedNotes.map((o) => ({
          id: o.noteId, content: '', anchorText: o.text, elementType: o.elementType,
          contextLabel: '', color: 'Yellow' as const, createdAt: new Date().toISOString(), sceneId: null,
        }))]);
      }
      if (orphanedTags.length > 0) {
        store.setTags([...store.tags, ...orphanedTags.map((o) => ({
          id: o.tagId, categoryId: o.categoryId, text: o.text, notes: '',
          sceneId: null, elementType: o.elementType, createdAt: new Date().toISOString(),
        }))]);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [editor]);

  // --- Scroll → current page tracking ---
  const handleScroll = useCallback(() => {
    if (!editorMainRef.current || !pageRef.current) return;
    const containerTop = editorMainRef.current.getBoundingClientRect().top;
    const pageTop = pageRef.current.getBoundingClientRect().top;
    let page = 1;
    for (const ov of overlays) {
      if (pageTop + ov.top - containerTop < 50) page = ov.pageNumber;
    }
    setCurrentPage(page);
  }, [overlays, setCurrentPage]);

  useEffect(() => {
    const el = editorMainRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // --- Go to page ---
  const handleGoToPage = useCallback((page: number) => {
    if (!editorMainRef.current || !pageRef.current) return;
    if (page <= 1) {
      editorMainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const ov = overlays.find(o => o.pageNumber === page);
    if (ov) {
      const pageRect = pageRef.current.getBoundingClientRect();
      const containerRect = editorMainRef.current.getBoundingClientRect();
      const scrollTo = editorMainRef.current.scrollTop + (pageRect.top + ov.top - containerRect.top);
      editorMainRef.current.scrollTo({ top: scrollTo, behavior: 'smooth' });
    }
  }, [overlays]);

  // Wire up the picker trigger
  showPickerRef.current = useCallback((defaultType: ElementType) => {
    if (!editor) return;
    // Use requestAnimationFrame so the DOM has settled after the split
    requestAnimationFrame(() => {
      if (!editor.view) return;
      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      setPickerState({
        visible: true,
        position: { top: coords.bottom + 4, left: coords.left },
        defaultType,
      });
    });
  }, [editor]);

  const handlePickerSelect = useCallback((type: ElementType) => {
    if (!editor) return;
    editor.chain().focus().setNode(type).run();
    setPickerState(s => ({ ...s, visible: false }));
  }, [editor]);

  const handlePickerDismiss = useCallback(() => {
    setPickerState(s => ({ ...s, visible: false }));
    // Re-focus editor
    editor?.commands.focus();
  }, [editor]);

  const handleOpenFromProject = useCallback(
    async (projectId: string, project: import('../services/api').ProjectInfo, scriptId: string, scriptTitle: string) => {
      if (!editor) {
        console.error('Editor not available');
        return;
      }
      setOpenFromProjectOpen(false);
      try {
        const scriptResp = await api.getScript(projectId, scriptId);
        const content = scriptResp.content as Record<string, unknown> | null;

        try {
          if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
            const { _notes, _tags, _tagCategories, _characterProfiles, ...pmDoc } = content as any;
            editor.commands.setContent(pmDoc);
          } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
            editor.commands.setContent(content);
          } else {
            editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
          }
        } catch (setErr) {
          console.error('setContent failed, using blank doc:', setErr);
          showToast(`Failed to render content: ${setErr instanceof Error ? setErr.message : String(setErr)}`, 'error');
          editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
        }

        // Restore metadata from top-level content keys
        const store = useEditorStore.getState();
        const parseAttr2 = (val: unknown): unknown[] => {
          if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
          if (Array.isArray(val)) return val;
          return [];
        };
        if (content) {
          const c = content as Record<string, unknown>;
          const notes2 = parseAttr2(c._notes);
          if (notes2.length > 0) store.setNotes(notes2 as import('../stores/editorStore').NoteInfo[]);
          const tags2 = parseAttr2(c._tags);
          if (tags2.length > 0) store.setTags(tags2 as import('../stores/editorStore').TagItem[]);
          const tagCats2 = parseAttr2(c._tagCategories);
          if (tagCats2.length > 0) store.setTagCategories(tagCats2 as import('../stores/editorStore').TagCategory[]);
          const profiles2 = parseAttr2(c._characterProfiles);
          if (profiles2.length > 0) {
            for (const prof of profiles2 as Record<string, unknown>[]) {
              if (prof.name && typeof prof.name === 'string') {
                store.upsertCharacterProfile(prof.name, {
                  description: (prof.description as string) || '',
                  color: (prof.color as string) || '',
                  highlighted: (prof.highlighted as boolean) || false,
                  gender: (prof.gender as string) || '',
                  age: (prof.age as string) || '',
                });
              }
            }
          }
        }

        setCurrentProject(project);
        setCurrentScriptId(scriptId);
        setDocumentTitle(scriptTitle);
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to open script:', err);
        alert('Failed to open script. Make sure the backend server is running on port 8000.');
      }
    },
    [editor, setOpenFromProjectOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes],
  );

  const handleWelcomeClose = useCallback(() => {
    setShowWelcome(false);
    localStorage.setItem('opendraft:welcomed', 'true');
  }, []);

  const handleSaveAsComplete = useCallback(
    async (projectId: string, _projectName: string, scriptId: string, scriptTitle: string) => {
      setSaveAsOpen(false);
      try {
        const project = await api.getProject(projectId);
        setCurrentProject(project);
        setCurrentScriptId(scriptId);
        setDocumentTitle(scriptTitle);
        const scripts = await api.listScripts(projectId);
        useProjectStore.getState().setScripts(scripts);
      } catch (err) {
        console.error('Failed to finalize save:', err);
      }
    },
    [setSaveAsOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle],
  );


  const handleCharAutoSelect = useCallback((name: string) => {
    if (!editor) return;
    // Replace the current character block text with the selected name
    const { $from } = editor.state.selection;
    const start = $from.start();
    const end = $from.end();
    editor.chain().focus()
      .command(({ tr }) => {
        tr.insertText(name, start, end);
        return true;
      })
      .run();
    setCharAutoState(s => ({ ...s, visible: false }));
  }, [editor]);

  const handleCharAutoDismiss = useCallback(() => {
    setCharAutoState(s => ({ ...s, visible: false }));
    charAutoDismissedRef.current = true;
  }, []);

  // --- Click on script note highlight → auto-filter notes panel ---
  useEffect(() => {
    if (!editor) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const noteEl = target.closest('.script-note-highlight') as HTMLElement | null;
      if (!noteEl) return;

      const noteId = noteEl.getAttribute('data-note-id');
      if (!noteId) return;

      const store = useEditorStore.getState();
      const note = store.notes.find((n) => n.id === noteId);
      if (!note) return;

      // Filter to this specific note
      store.setNoteFilter({
        elementType: null,
        contextLabel: null,
        color: null,
        noteId: noteId,
      });

      // Open the notes panel if not already open
      if (!store.scriptNotesOpen) store.toggleScriptNotes();
    };

    const editorEl = editor.view.dom;
    editorEl.addEventListener('click', handleClick);
    return () => editorEl.removeEventListener('click', handleClick);
  }, [editor]);

  // --- Script context menu (right-click) ---
  useEffect(() => {
    if (!editor) return;
    const handleContextMenu = (e: MouseEvent) => {
      // Only intercept right-click inside the editor area
      const editorDom = editor.view.dom;
      if (!editorDom.contains(e.target as Node)) return;
      e.preventDefault();

      // Move cursor to click position only if no text is selected,
      // or if the click is outside the current selection
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (pos) {
        const { from, to } = editor.state.selection;
        const clickInSelection = pos.pos >= from && pos.pos <= to && from !== to;
        if (!clickInSelection) {
          editor.commands.setTextSelection(pos.pos);
        }
      }

      // Check if clicked on a misspelled word
      let spellInfo: { word: string; from: number; to: number; suggestions: string[] } | null = null;
      const target = e.target as HTMLElement;
      if (target.classList.contains('spell-error') || target.closest('.spell-error')) {
        const spellEl = target.classList.contains('spell-error') ? target : target.closest('.spell-error');
        if (spellEl && pos) {
          // Find the decoration range by examining the spell error text
          const pluginState = spellCheckPluginKey.getState(editor.state) as { decorations: import('@tiptap/pm/view').DecorationSet; enabled: boolean } | undefined;
          if (pluginState?.enabled) {
            const decos = pluginState.decorations.find(pos.pos, pos.pos);
            if (decos.length > 0) {
              const deco = decos[0];
              const word = editor.state.doc.textBetween(deco.from, deco.to);
              spellInfo = {
                word,
                from: deco.from,
                to: deco.to,
                suggestions: spellChecker.suggest(word),
              };
            }
          }
        }
      }

      setCtxMenuState({
        visible: true,
        position: { x: e.clientX, y: e.clientY },
        spellInfo,
      });
    };

    // Attach to the editor's parent to catch all right-clicks in the editor area
    const editorEl = editor.view.dom.parentElement;
    if (editorEl) {
      editorEl.addEventListener('contextmenu', handleContextMenu);
      return () => editorEl.removeEventListener('contextmenu', handleContextMenu);
    }
  }, [editor]);

  const handleCtxMenuClose = useCallback(() => {
    setCtxMenuState(s => ({ ...s, visible: false }));
  }, []);

  // --- Spell check: open modal when toggled on (or from menu) ---
  // The modal is opened via the Tools menu or spellCheckEnabled toggle.

  const zoomScale = zoomLevel / 100;

  return (
    <div className="app-container">
      <MenuBar editor={editor} />
      <Toolbar editor={editor} />
      <div className="editor-layout">
        <SceneNavigator editor={editor} scrollContainer={editorMainRef.current} />
        <div className="editor-center">
          <IndexCards editor={editor} scrollContainer={editorMainRef.current} />
          {beatBoardOpen ? (
            <BeatBoard editor={editor} />
          ) : (
            <div className="editor-main" ref={editorMainRef}>
              <div
                className="page-container"
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top center',
                  width: `${pageLayout.pageWidth}in`,
                  minWidth: `${pageLayout.pageWidth}in`,
                  maxWidth: `${pageLayout.pageWidth}in`,
                }}
              >
                <div
                  className={`page${!tagsVisible ? ' tags-hidden' : ''}${!notesVisible ? ' notes-hidden' : ''}`}
                  ref={pageRef}
                  style={{
                    fontFamily: `'${fontFamily}', 'Courier New', Courier, monospace`,
                    fontSize: `${fontSize}pt`,
                    width: `${pageLayout.pageWidth}in`,
                    minHeight: `${pageLayout.pageHeight}in`,
                    paddingTop: `${pageLayout.topMargin}pt`,
                    paddingBottom: `${pageLayout.bottomMargin}pt`,
                    paddingLeft: `${pageLayout.leftMargin}in`,
                    paddingRight: `${pageLayout.rightMargin}in`,
                    // CSS variables for element padding calculations
                    ...{ '--pl': `${pageLayout.leftMargin}in` } as React.CSSProperties,
                    ...{ '--pr': `${pageLayout.rightMargin}in` } as React.CSSProperties,
                    ...{ '--pw': `${pageLayout.pageWidth}in` } as React.CSSProperties,
                  }}
                >
                  {/* Page break separators — absolutely positioned, full page width */}
                  {overlays.map((ov) => (
                    <div
                      key={ov.pageNumber}
                      className="page-sep"
                      style={{ top: `${ov.top}px` }}
                    >
                      <div className="page-sep-bottom" style={{ height: `${pageLayout.bottomMargin}pt`, position: 'relative' }}>
                        {ov.isDialogueSplit && (
                          <div className="page-sep-more">(MORE)</div>
                        )}
                      </div>
                      <div className="page-sep-gap" />
                      <div className="page-sep-top" style={{ height: `${pageLayout.topMargin}pt` }}>
                        <span className="page-sep-number" style={{ right: `${(pageLayout.pageWidth - 7.25)}in` }}>{ov.pageNumber}.</span>
                      </div>
                      {ov.isDialogueSplit && ov.characterName && (
                        <div className="page-sep-contd">
                          {ov.characterName} (CONT'D)
                        </div>
                      )}

                    </div>
                  ))}

                  <EditorContent editor={editor} />
                </div>
              </div>
            </div>
          )}
        </div>
        <ScriptNotes editor={editor} />
        <CharacterProfiles editor={editor} />
        <TagsPanel editor={editor} />
      </div>
      <SearchReplace editor={editor} />
      <GoToPage onGoToPage={handleGoToPage} />
      {pickerState.visible && (
        <ElementPicker
          position={pickerState.position}
          defaultType={pickerState.defaultType}
          onSelect={handlePickerSelect}
          onDismiss={handlePickerDismiss}
        />
      )}
      {charAutoState.visible && !pickerState.visible && (
        <CharacterAutocomplete
          position={charAutoState.position}
          suggestions={charAutoState.suggestions}
          onSelect={handleCharAutoSelect}
          onDismiss={handleCharAutoDismiss}
        />
      )}
      {ctxMenuState.visible && editor && (
        <ScriptContextMenu
          editor={editor}
          position={ctxMenuState.position}
          spellInfo={ctxMenuState.spellInfo}
          onClose={handleCtxMenuClose}
          onOpenFormatPanel={() => setFormatPanelOpen(true)}
        />
      )}
      {formatPanelOpen && editor && (
        <FormatPanel editor={editor} onClose={() => setFormatPanelOpen(false)} />
      )}
      {spellModalOpen && editor && (
        <SpellCheckModal
          editor={editor}
          onClose={() => setSpellModalOpen(false)}
        />
      )}
      <VersionHistory />
      {currentProject && <AssetManager projectId={currentProject.id} />}
      {openFromProjectOpen && (
        <OpenFromProject
          onOpen={handleOpenFromProject}
          onClose={() => setOpenFromProjectOpen(false)}
        />
      )}
      {showWelcome && <WelcomeDialog onClose={handleWelcomeClose} />}
      {saveAsOpen && (
        <SaveAsDialog
          defaultProjectName="My Project"
          defaultFileName="First Draft"
          onSaved={handleSaveAsComplete}
          onClose={() => setSaveAsOpen(false)}
          buildContent={buildSaveContent}
        />
      )}
      <StatusBar />
    </div>
  );
};

export default ScreenplayEditor;
