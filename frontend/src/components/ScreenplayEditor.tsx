import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import History from '@tiptap/extension-history';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { Extension } from '@tiptap/core';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

import {
  SceneHeading, Action, Character, Dialogue, Parenthetical,
  Transition, General, Shot, NewAct, EndOfAct, Lyrics,
  ShowEpisode, CastList, FontSize, ScriptNoteMark, TagMark,
  FormatOverride, CustomElement,
} from '../editor/extensions';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { generateTemplateCss, injectTemplateCss } from '../utils/templateCss';
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
// MobileAccessoryBar removed — context menu via 3-finger touch only
import ScriptContextMenu from './ScriptContextMenu';
import { SpellCheck, spellCheckPluginKey } from '../editor/extensions/SpellCheck';
import { spellChecker } from '../editor/spellchecker';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { API_BASE, getCollabWsUrl } from '../config';
import { showToast } from './Toast';
import VersionHistory from './VersionHistory';
import AssetManager from './AssetManager';
import { useParams, useNavigate } from 'react-router-dom';
import OpenFromProject from './OpenFromProject';
import WelcomeDialog, { type WelcomeChoice } from './WelcomeDialog';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import { parseOdraft } from '../utils/odraftFormat';
import SaveAsDialog from './SaveAsDialog';
import ShareDialog from './ShareDialog';
import CollabLoginDialog from './CollabLoginDialog';
import JoinCollabDialog from './JoinCollabDialog';
import CompareVersionPicker from './CompareVersionPicker';
import ZoomPanel from './ZoomPanel';
import { useIsTouchDevice, useSwipeEdge, usePinchZoom } from '../hooks/useTouch';
import { useSettingsStore } from '../stores/settingsStore';
import { startCollabSync, stopCollabSync } from '../services/collabSync';
import { collabAuthApi, setLogoutCollabTeardown, isCollabAuthenticated } from '../services/collabAuth';
import { platformFetch } from '../services/platform';
import { pluginRegistry } from '../plugins/registry';
import { createTrackChangesPlugin, trackChangesPluginKey } from '../editor/trackChanges';
import type { VersionInfo } from '../services/api';

// Vibrant dark colors for collaboration cursors and avatars
const COLLAB_COLORS = [
  '#7C3AED', '#DC2626', '#D97706', '#059669', '#2563EB',
  '#DB2777', '#7C2D12', '#4338CA', '#0E7490', '#9333EA',
];
function randomCollabColor() {
  return COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
}

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
  const { projectId: urlProjectId, scriptId: urlScriptId, commitHash: urlCommitHash, collabToken: urlCollabToken } = useParams<{ projectId?: string; scriptId?: string; commitHash?: string; collabToken?: string }>();
  const navigate = useNavigate();
  const isHistoryMode = Boolean(urlCommitHash);

  const {
    setActiveElement, setScenes, setPageCount, setCurrentPage,
    zoomLevel, setZoomLevel, fontFamily, fontSize, pageLayout, tagsVisible, notesVisible,
    beatBoardOpen,
    navigatorOpen, toggleNavigator, scriptNotesOpen, toggleScriptNotes,
    characterProfilesOpen, tagsPanelOpen,
    spellCheckEnabled, setDocumentTitle,
  } = useEditorStore();

  const { currentProject, currentScriptId, setCurrentProject, setCurrentScriptId, scriptReloadKey } = useProjectStore();

  // ── Collaboration state ──
  const [collabMode, setCollabMode] = useState(false);
  const [collabUserName, setCollabUserName] = useState('Owner');
  const [isCollabHost, setIsCollabHost] = useState(false);
  const [collabRole, setCollabRole] = useState<'editor' | 'viewer'>('editor');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [collabLoginOpen, setCollabLoginOpen] = useState(false);
  const [joinCollabOpen, setJoinCollabOpen] = useState(false);
  const [collabUsers, setCollabUsers] = useState<{ name: string; color: string }[]>([]);
  const collabColor = useMemo(() => randomCollabColor(), []);

  // ── Panel resize state ──
  const [navWidth, setNavWidth] = useState(240);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const resizingRef = useRef<'left' | 'right' | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const handleResizePointerDown = useCallback((side: 'left' | 'right', e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = side;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = side === 'left' ? navWidth : rightPanelWidth;

    const handlePointerMove = (ev: PointerEvent) => {
      const delta = ev.clientX - resizeStartXRef.current;
      if (resizingRef.current === 'left') {
        setNavWidth(Math.max(160, Math.min(500, resizeStartWidthRef.current + delta)));
      } else {
        setRightPanelWidth(Math.max(200, Math.min(600, resizeStartWidthRef.current - delta)));
      }
    };

    const handlePointerUp = () => {
      resizingRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [navWidth, rightPanelWidth]);

  const rightPanelVisible = scriptNotesOpen || characterProfilesOpen || tagsPanelOpen;

  // Yjs document & provider — stable across renders while collab is active
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  // Editor ref for onSynced callback to seed content when Yjs doc is empty
  const collabEditorRef = useRef<ReturnType<typeof useEditor>>(null);
  // Track current collab document name to prevent duplicate setup (React StrictMode)
  const collabDocNameRef = useRef<string | null>(null);

  // Cleanup collab provider
  const destroyCollab = useCallback(() => {
    stopCollabSync();
    collabDocNameRef.current = null;
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
      ydocRef.current = null;
    }
    setCollabUsers([]);
  }, []);

  // Guard to prevent duplicate collab-exit handling (awareness fires multiple
  // times, and onAuthenticationFailed may also fire after session-ended).
  const collabExitingRef = useRef(false);

  // Called when host broadcasts session-ended — guest auto-disconnects
  const handleSessionEnded = useCallback(() => {
    if (collabExitingRef.current) return;
    collabExitingRef.current = true;
    showToast('The host has ended the collaboration session', 'info');
    destroyCollab();
    setCollabMode(false);
    setIsCollabHost(false);
    setCollabRole('editor');
    // Clear project context so sample content can't overwrite the real file on save
    setCurrentProject(null);
    setCurrentScriptId(null);
    setDocumentTitle('Untitled Screenplay');
    setEditorKey((k) => k + 1);
    navigate('/');
  }, [destroyCollab, navigate, setCurrentProject, setCurrentScriptId, setDocumentTitle]);

  const handleSessionEndedRef = useRef(handleSessionEnded);
  handleSessionEndedRef.current = handleSessionEnded;

  // Ref for document-switch handler (defined after setupCollab to avoid circular dependency)
  const handleDocumentSwitchRef = useRef<(projectId: string, scriptId: string, token: string) => void>(() => {});

  const setupCollab = useCallback((docName: string, inviteToken: string, _userName: string, isHost = false, overrideWsUrl?: string) => {
    // Skip if already setting up the same document (prevents React StrictMode
    // double-invoke from destroying a provider that's still connecting)
    if (collabDocNameRef.current === docName && providerRef.current) {
      return;
    }
    destroyCollab();
    collabDocNameRef.current = docName;
    collabExitingRef.current = false;
    const ydoc = new Y.Doc();

    // Build compound token: "jwt:<access>|invite:<invite>" when auth is available and valid
    const { collabAuth, clearCollabAuth } = useSettingsStore.getState();
    let token = inviteToken;
    if (collabAuth.accessToken) {
      // Check JWT expiry client-side to avoid sending expired tokens
      try {
        const payload = JSON.parse(atob(collabAuth.accessToken.split('.')[1]));
        if (payload.exp && payload.exp * 1000 > Date.now()) {
          token = `jwt:${collabAuth.accessToken}|invite:${inviteToken}`;
        } else {
          // JWT expired — clear it so we don't keep sending it
          clearCollabAuth();
        }
      } catch {
        // Malformed JWT — just use invite token
        clearCollabAuth();
      }
    }

    // Use the collab server URL extracted from the invite link if provided,
    // otherwise fall back to the local setting.
    const wsUrl = overrideWsUrl || getCollabWsUrl();
    console.log(`[Collab] setupCollab: docName="${docName}", wsUrl="${wsUrl}", isHost=${isHost}, tokenPrefix="${inviteToken.slice(0, 8)}..."`);

    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: docName,
      document: ydoc,
      token,
      onConnect: () => {
        console.log(`[Collab] Connected to room "${docName}" (${isHost ? 'host' : 'guest'})`);
      },
      onClose: ({ event }) => {
        console.log(`[Collab] Connection closed for "${docName}": code=${event.code}`);
      },
      onSynced: ({ state }) => {
        console.log(`[Collab] Synced for "${docName}": state=${state}, isHost=${isHost}`);
        // After initial sync, if the Yjs doc is empty (fresh room) and we have
        // content to seed, force-set it via the editor.
        if (state && isHost && providerRef.current === provider) {
          const fragment = ydoc.getXmlFragment('default');
          if (fragment.length === 0 && collabInitialContent.current) {
            console.log('[Collab] Yjs doc empty after sync — seeding from initial content');
            const ed = collabEditorRef.current;
            if (ed && !ed.isDestroyed) {
              ed.commands.setContent(collabInitialContent.current);
            }
          }
        }
      },
      onAuthenticationFailed: ({ reason }) => {
        // Ignore auth failures from a stale provider (e.g. old provider fires
        // after host switched documents and a new provider replaced it)
        if (providerRef.current !== provider) return;
        // Skip if session-ended already handled the exit
        if (collabExitingRef.current) {
          provider.disconnect();
          return;
        }
        collabExitingRef.current = true;

        console.error(`[Collab] Auth FAILED for "${docName}": ${reason}`);
        const isSessionEnded = reason?.includes('expired') || reason?.includes('Invalid');
        showToast(
          isSessionEnded
            ? 'The collaboration session has ended'
            : `Unable to join collaboration: ${reason}`,
          isSessionEnded ? 'info' : 'error',
        );
        // Prevent reconnection loop — disconnect provider immediately, then clean up
        provider.disconnect();
        setTimeout(() => {
          destroyCollab();
          setCollabMode(false);
          setCollabRole('editor');
          if (!isHost) {
            // Clear project context so sample content can't overwrite the real file
            setCurrentProject(null);
            setCurrentScriptId(null);
            setDocumentTitle('Untitled Screenplay');
          }
          setEditorKey((k) => k + 1);
          if (!isHost) navigate('/');
        }, 0);
      },
      onAwarenessUpdate: ({ states }) => {
        // Ignore events from a stale provider after doc switch
        if (providerRef.current !== provider) return;

        const users: { name: string; color: string }[] = [];
        let sessionEnded = false;
        let switchProjectId = '';
        let switchScriptId = '';
        let switchToken = '';
        states.forEach((state: Record<string, unknown>) => {
          const user = state.user as { name: string; color: string; sessionEnded?: boolean; documentSwitch?: { projectId: string; scriptId: string; token: string } } | undefined;
          if (user?.sessionEnded) sessionEnded = true;
          if (user?.documentSwitch) {
            switchProjectId = user.documentSwitch.projectId;
            switchScriptId = user.documentSwitch.scriptId;
            switchToken = user.documentSwitch.token;
          }
          if (user?.name) users.push(user);
        });
        setCollabUsers(users);
        // Only guests react to sessionEnded / documentSwitch — the host
        // handles these itself via handleStopCollab / switchCollabDocument.
        // Without this guard the host processes its OWN awareness broadcast,
        // causing a second setupCollab that fights with the first.
        if (isHost) return;
        if (sessionEnded) {
          handleSessionEndedRef.current();
        }
        if (switchProjectId && switchScriptId && switchToken) {
          handleDocumentSwitchRef.current(switchProjectId, switchScriptId, switchToken);
        }
      },
    });
    ydocRef.current = ydoc;
    providerRef.current = provider;

    // Start syncing metadata (characters, notes, tags, beats) via Yjs
    startCollabSync(ydoc, isHost);
  }, [destroyCollab]);

  // Called when host broadcasts document-switch — guest auto-follows
  const handleDocumentSwitch = useCallback(async (projectId: string, scriptId: string, sharedToken: string) => {
    try {
      // Validate the shared token to get the session_nonce for the room name
      const session = await api.validateCollabSession(sharedToken);
      const nonce = session.session_nonce || '';

      const project = await api.getProject(projectId);
      const scriptResp = await api.getScript(projectId, scriptId);

      const content = scriptResp.content as Record<string, unknown> | null;
      if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
        const { _notes, _generalNotes, _tags, _tagCategories, _characterProfiles, _templateId, ...pmDoc } = content as Record<string, unknown>;
        collabInitialContent.current = pmDoc;
      } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
        collabInitialContent.current = content;
      }

      // Restore per-document template
      const tplId = (content as any)?._templateId;
      useFormattingTemplateStore.getState().setActiveTemplateId(typeof tplId === 'string' ? tplId : null);

      const docName = `${projectId}/${scriptId}${nonce ? `/${nonce}` : ''}`;
      setupCollab(docName, sharedToken, collabUserName);

      setCurrentProject(project);
      setCurrentScriptId(scriptId);
      setDocumentTitle(scriptResp.meta.title);
      setEditorKey((k) => k + 1);
      showToast(`Host switched to: ${scriptResp.meta.title}`, 'info');
    } catch {
      showToast('Failed to follow host to new document', 'error');
    }
  }, [setupCollab, collabUserName, setCurrentProject, setCurrentScriptId, setDocumentTitle]);

  handleDocumentSwitchRef.current = handleDocumentSwitch;

  // Force editor recreation when collab mode toggles
  const [editorKey, setEditorKey] = useState(0);

  const editorMainRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const setPageCountRef = useRef(setPageCount);
  setPageCountRef.current = setPageCount;
  const pageLayoutRef = useRef(pageLayout);
  pageLayoutRef.current = pageLayout;

  // ── Touch gestures (must be after editorMainRef) ──
  const isTouch = useIsTouchDevice();
  useSwipeEdge({
    edge: 'left',
    onSwipe: toggleNavigator,
    enabled: isTouch && !navigatorOpen && typeof window !== 'undefined' && window.innerWidth <= 900,
  });
  useSwipeEdge({
    edge: 'right',
    onSwipe: toggleScriptNotes,
    enabled: isTouch && !rightPanelVisible,
  });
  usePinchZoom(editorMainRef, {
    currentZoom: zoomLevel,
    onZoomChange: setZoomLevel,
    enabled: isTouch && !beatBoardOpen,
  });

  // 3-finger touch opens context menu on touch devices
  useEffect(() => {
    if (!isTouch) return;
    const handleThreeFingerTouch = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        // Use center of the three touches as position
        let cx = 0, cy = 0;
        for (let i = 0; i < 3; i++) {
          cx += e.touches[i].clientX;
          cy += e.touches[i].clientY;
        }
        cx /= 3;
        cy /= 3;
        setCtxMenuState({ visible: true, position: { x: cx, y: cy }, spellInfo: null });
      }
    };
    document.addEventListener('touchstart', handleThreeFingerTouch, { passive: false });
    return () => document.removeEventListener('touchstart', handleThreeFingerTouch);
  }, [isTouch]);

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const [overlays, setOverlays] = useState<OverlayInfo[]>([]);

  const {
    openFromProjectOpen, setOpenFromProjectOpen, saveAsOpen, setSaveAsOpen,
    compareVersionOpen, setCompareVersionOpen,
    setTrackChangesEnabled, setTrackChangesLabel,
  } = useEditorStore();

  // Auto-fit page to viewport on mobile/tablet
  const autoZoomApplied = useRef(false);
  useEffect(() => {
    const handleAutoZoom = () => {
      if (window.innerWidth <= 768 && editorMainRef.current) {
        const containerWidth = editorMainRef.current.clientWidth - 16; // small padding
        const pageWidthPx = pageLayout.pageWidth * 96; // 1in = 96px
        const fitZoom = Math.floor((containerWidth / pageWidthPx) * 100);
        setZoomLevel(Math.max(50, Math.min(100, fitZoom)));
        autoZoomApplied.current = true;
      } else if (autoZoomApplied.current && window.innerWidth > 768) {
        setZoomLevel(100);
        autoZoomApplied.current = false;
      }
    };
    // Delay initial call to ensure editorMainRef is measured
    const timer = setTimeout(handleAutoZoom, 100);
    window.addEventListener('resize', handleAutoZoom);
    window.addEventListener('orientationchange', handleAutoZoom);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleAutoZoom);
      window.removeEventListener('orientationchange', handleAutoZoom);
    };
  }, [pageLayout.pageWidth, setZoomLevel]);

  // ── Handle /collab/:token route — resolve token to project/script, then enter collab mode ──
  const collabInitDone = useRef(false);
  const collabInitialContent = useRef<Record<string, unknown> | null>(null);
  const [collabLoading, setCollabLoading] = useState(Boolean(urlCollabToken));
  useEffect(() => {
    if (!urlCollabToken || collabInitDone.current) return;
    collabInitDone.current = true;
    (async () => {
      try {
        // Try collab server first (validates against all configured backends),
        // then fall back to local backend
        let session: import('../services/api').CollabSession | null = null;
        const collabHttpUrl = getCollabWsUrl().replace(/^ws/, 'http');
        try {
          const res = await platformFetch(`${collabHttpUrl}/api/collab/session/${urlCollabToken}`);
          if (res.ok) session = await res.json();
        } catch { /* collab server unreachable */ }
        if (!session) {
          session = await api.validateCollabSession(urlCollabToken);
        }

        // Load script content FIRST so the editor can seed the Yjs doc.
        // Try multiple backends (local + alternatives) for cross-backend joins.
        // Derive host from the collab server URL setting so cross-machine access works.
        const collabHost = (() => { try { return new URL(collabHttpUrl).hostname; } catch { return 'localhost'; } })();
        const backends = [
          API_BASE,
          `http://${collabHost}:8000/api`,
          `http://${collabHost}:18321/api`,
        ].filter((v, i, a) => a.indexOf(v) === i);

        let project: any = null;
        let scriptResp: any = null;
        for (const base of backends) {
          try {
            const pRes = await platformFetch(`${base}/projects/${session.project_id}`);
            if (!pRes.ok) continue;
            project = await pRes.json();
            const sRes = await platformFetch(`${base}/projects/${session.project_id}/scripts/${session.script_id}`);
            if (!sRes.ok) continue;
            scriptResp = await sRes.json();
            break;
          } catch { /* try next */ }
        }

        // Seed the Yjs doc if content was loaded; otherwise Yjs will sync from host
        if (scriptResp) {
          const content = scriptResp.content as Record<string, unknown> | null;
          if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
            const { _notes, _generalNotes, _tags, _tagCategories, _characterProfiles, _templateId, ...pmDoc } = content as Record<string, unknown>;
            collabInitialContent.current = pmDoc;
          } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
            collabInitialContent.current = content;
          }
        }

        // Setup provider synchronously before triggering editor rebuild
        // Include session_nonce so guest joins the exact same Yjs room as the host
        const nonce = session.session_nonce || '';
        const docName = `${session.project_id}/${session.script_id}${nonce ? `/${nonce}` : ''}`;
        setupCollab(docName, urlCollabToken, session.collaborator_name);

        setCollabUserName(session.collaborator_name);
        setCollabRole((session.role as 'editor' | 'viewer') || 'editor');
        setCollabMode(true);
        setEditorKey((k) => k + 1);

        setCurrentProject(project || { id: session.project_id, name: 'Collaboration' });
        setCurrentScriptId(session.script_id);
        setDocumentTitle(scriptResp?.meta?.title || 'Untitled');
        setCollabLoading(false);

        if (session.role === 'viewer') {
          showToast('Connected as viewer (read-only)', 'info');
        }
      } catch (err) {
        showToast('Invalid or expired collaboration link', 'error');
        setCollabLoading(false);
        navigate('/');
      }
    })();
  }, [urlCollabToken, navigate, setCurrentProject, setCurrentScriptId, setDocumentTitle, setupCollab]);

  // handleStartCollab is defined after the editor — see below useEditor

  const handleStopCollab = useCallback(async () => {
    const isHost = isCollabHost;

    // Host: save the latest editor content before tearing down collab so it's not lost
    const ed = collabEditorRef.current;
    if (isHost && ed && !ed.isDestroyed && currentProject && currentScriptId) {
      const doc = ed.getJSON();
      const store = useEditorStore.getState();
      const content = {
        ...doc,
        _notes: store.notes,
        _generalNotes: store.generalNotes,
        _tags: store.tags,
        _tagCategories: store.tagCategories,
        _characterProfiles: store.characterProfiles,
      };
      try {
        await api.saveScript(currentProject.id, currentScriptId, { content });
      } catch { /* best-effort — auto-save will catch up */ }
    }

    if (isHost && currentProject && currentScriptId) {
      // Host: broadcast session-ended to all connected guests via awareness
      if (providerRef.current) {
        providerRef.current.setAwarenessField('user', {
          name: collabUserName,
          color: collabColor,
          sessionEnded: true,
        });
        // Brief delay to allow awareness to propagate before destroying
        await new Promise((r) => setTimeout(r, 300));
      }
      // Host: revoke all invitation links
      try {
        await api.revokeAllCollabSessions(currentProject.id, currentScriptId);
      } catch { /* ignore — cleanup is best-effort */ }

      // Host: kick all remaining connections on the collab server.
      // Use the actual room name (includes nonce) so closeConnections matches.
      const docName = collabDocNameRef.current || `${currentProject.id}/${currentScriptId}`;
      try {
        await collabAuthApi.closeDocument(docName);
      } catch { /* best-effort */ }
    }

    destroyCollab();
    setCollabMode(false);
    setIsCollabHost(false);
    setCollabRole('editor');

    if (isHost && currentProject && currentScriptId) {
      // Navigate to the project URL so the content-loading effect reloads the saved file
      navigate(`/project/${currentProject.id}/edit/${currentScriptId}`);
      showToast('Collaboration session ended', 'success');
    } else if (isHost) {
      setEditorKey((k) => k + 1);
      showToast('Collaboration session ended', 'success');
    } else {
      // Clear project context so sample content can't overwrite the real file
      setCurrentProject(null);
      setCurrentScriptId(null);
      setDocumentTitle('Untitled Screenplay');
      setEditorKey((k) => k + 1);
      navigate('/');
    }
  }, [destroyCollab, collabUserName, collabColor, currentProject, currentScriptId, navigate, setCurrentProject, setCurrentScriptId, setDocumentTitle]);

  // Host switches to a different document while collab is active
  const switchCollabDocument = useCallback(async (newProjectId: string, newScriptId: string) => {
    if (!providerRef.current) return;

    // 1. Create a shared invite token for the new document so guests can follow
    let sharedToken: string;
    let sharedNonce: string;
    try {
      const invite = await api.createCollabInvite(newProjectId, newScriptId, 'Guest', 'editor', 1);
      sharedToken = invite.token;
      sharedNonce = invite.session_nonce || '';
    } catch {
      showToast('Failed to create invite for new document', 'error');
      return;
    }

    // 2. Broadcast document-switch to all guests via awareness
    // (Old invites are NOT revoked here — they expire naturally.
    //  Revoking during switch caused a race where the backend file write
    //  from revoke could corrupt reads from concurrent token validation.)
    providerRef.current.setAwarenessField('user', {
      name: collabUserName,
      color: collabColor,
      documentSwitch: { projectId: newProjectId, scriptId: newScriptId, token: sharedToken },
    });
    await new Promise((r) => setTimeout(r, 400));

    // 4. Load the new script content and reconnect host
    try {
      const project = await api.getProject(newProjectId);
      const scriptResp = await api.getScript(newProjectId, newScriptId);

      const content = scriptResp.content as Record<string, unknown> | null;
      if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
        const { _notes, _generalNotes, _tags, _tagCategories, _characterProfiles, _templateId, ...pmDoc } = content as Record<string, unknown>;
        collabInitialContent.current = pmDoc;
      } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
        collabInitialContent.current = content;
      }

      // Create host's own token for the new document, sharing the same nonce
      let hostToken: string;
      try {
        const hostInvite = await api.createCollabInvite(newProjectId, newScriptId, collabUserName, 'editor', 24, sharedNonce);
        hostToken = hostInvite.token;
      } catch {
        hostToken = sharedToken;
      }

      const docName = `${newProjectId}/${newScriptId}${sharedNonce ? `/${sharedNonce}` : ''}`;
      setupCollab(docName, hostToken, collabUserName, true);

      setCurrentProject(project);
      setCurrentScriptId(newScriptId);
      setDocumentTitle(scriptResp.meta.title);
      setEditorKey((k) => k + 1);
    } catch {
      showToast('Failed to switch collab document', 'error');
    }
  }, [collabColor, currentProject, currentScriptId, setupCollab, setCurrentProject, setCurrentScriptId, setDocumentTitle]);

  // Join a collab session via pasted link/token (works from app without browser)
  const handleJoinCollab = useCallback(async (session: import('../services/api').CollabSession, token: string, collabServerUrl?: string) => {
    try {
      // Determine the collab server to use: prefer URL extracted from invite link,
      // fall back to local setting.
      const collabWs = collabServerUrl || getCollabWsUrl();

      // Connect to the collab WebSocket immediately — Yjs will sync content from the host.
      // Do NOT wait for backend content loading (which may hang on unreachable ports).
      const nonce = session.session_nonce || '';
      const docName = `${session.project_id}/${session.script_id}${nonce ? `/${nonce}` : ''}`;
      setupCollab(docName, token, session.collaborator_name, false, collabWs);

      setCollabUserName(session.collaborator_name);
      setCollabRole((session.role as 'editor' | 'viewer') || 'editor');
      setCollabMode(true);
      setJoinCollabOpen(false);
      setEditorKey((k) => k + 1);

      // Set a placeholder project — Yjs will sync the actual content from the host
      setCurrentProject({ id: session.project_id, name: 'Collaboration' } as any);
      setCurrentScriptId(session.script_id);
      setDocumentTitle('Untitled');

      if (session.role === 'viewer') {
        showToast('Connected as viewer (read-only)', 'info');
      } else {
        showToast(`Joined collaboration as ${session.collaborator_name}`, 'success');
      }

      // Try to load project metadata in the background (non-blocking).
      // This fills in the title and project name if reachable, but is not required.
      try {
        const pRes = await platformFetch(`${API_BASE}/projects/${session.project_id}`);
        if (pRes.ok) {
          const project = await pRes.json();
          setCurrentProject(project as any);
          const sRes = await platformFetch(`${API_BASE}/projects/${session.project_id}/scripts/${session.script_id}`);
          if (sRes.ok) {
            const scriptResp = await sRes.json();
            setDocumentTitle(scriptResp?.meta?.title || 'Untitled');
          }
        }
      } catch {
        // Backend unreachable — fine, Yjs handles content sync
      }
    } catch (err) {
      console.error('[Collab] handleJoinCollab failed:', err);
      showToast(`Failed to join collaboration: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [setupCollab, setCurrentProject, setCurrentScriptId, setDocumentTitle]);

  // Register collab teardown so performLogout can end the session before clearing auth.
  // Uses a fast path: destroy locally first, then fire-and-forget server cleanup.
  useEffect(() => {
    setLogoutCollabTeardown(async () => {
      if (!collabMode) return;

      // Immediately disconnect — no awareness delay needed during signout
      const docName = collabDocNameRef.current;
      const projectId = currentProject?.id;
      const scriptId = currentScriptId;

      destroyCollab();
      setCollabMode(false);
      setIsCollabHost(false);
      setCollabRole('editor');

      // Fire-and-forget server cleanup (don't block signout)
      if (isCollabHost && projectId && scriptId) {
        api.revokeAllCollabSessions(projectId, scriptId).catch(() => {});
        if (docName) collabAuthApi.closeDocument(docName).catch(() => {});
      }
    });
    return () => { setLogoutCollabTeardown(null); };
  }, [collabMode, isCollabHost, currentProject, currentScriptId, destroyCollab]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { destroyCollab(); };
  }, [destroyCollab]);

  // Welcome dialog — show on first visit
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('opendraft:welcomed') && !urlScriptId && !urlCollabToken;
  });

  // ── Drag-and-drop file import state ──
  const [dragOverEditor, setDragOverEditor] = useState(false);
  const [pendingDropFile, setPendingDropFile] = useState<File | null>(null);
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);

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
    savedSelection?: { from: number; to: number };
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

    // getBoundingClientRect returns coordinates in viewport space (affected by
    // CSS transform: scale), but the overlay top is in the page's local
    // (unscaled) coordinate system.  Divide by zoom to convert.
    const scale = (zoomLevelRef.current || 100) / 100;
    const lineHeightPx = 12 * (96 / 72); // 16px — matches pagination LINE_HEIGHT_PT
    const newOverlays: OverlayInfo[] = [];
    for (const brk of breaks) {
      const el = children[brk.nodeIndex];
      if (!el) continue;
      const elRect = el.getBoundingClientRect();
      const contdHeight = brk.isDialogueSplit ? lineHeightPx : 0;
      const overlayTop = (elRect.top - pageRect.top) / scale - m.sepHeightPx - contdHeight;
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

  // Track changes plugin
  const [TrackChangesExtension] = React.useState(() =>
    Extension.create({
      name: 'trackChanges',
      addProseMirrorPlugins() {
        return [createTrackChangesPlugin()];
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

            // Check if cursor is at the very beginning of the block
            const atBlockStart = $from.parentOffset === 0;

            // Non-empty line: split block, then fix up both halves' types
            // Use template rules if available, fall back to DEFAULT_NEXT_TYPE
            const templateStore = useFormattingTemplateStore.getState();
            const activeTemplate = templateStore.getActiveTemplate();
            // For custom elements, use customTypeId to find the rule
            const effectiveType = currentType === 'customElement'
              ? (currentNode.attrs?.customTypeId || currentType)
              : currentType;
            const elementRule = activeTemplate.rules[effectiveType];
            const nextType = elementRule?.nextOnEnter || DEFAULT_NEXT_TYPE[currentType] || currentType;
            editor.chain().splitBlock().run();

            // After split, cursor is in the new (second) block.
            const { tr, schema, selection } = editor.state;
            const pos = selection.$from;
            const newBlockStart = pos.before(pos.depth);

            if (atBlockStart) {
              // Cursor was at position 0: user is inserting a blank line above.
              // The second block (with content) should keep the original type.
              // The first block (empty, above) becomes action for a clean blank line.
              const origNodeType = schema.nodes[currentType];
              if (origNodeType && tr.doc.nodeAt(newBlockStart)?.type.name !== currentType) {
                tr.setNodeMarkup(newBlockStart, origNodeType);
              }
              const prevResolved = tr.doc.resolve(newBlockStart - 1);
              const prevBlockStart = prevResolved.before(prevResolved.depth);
              const actionType = schema.nodes['action'];
              if (actionType && tr.doc.nodeAt(prevBlockStart)?.type.name !== 'action') {
                tr.setNodeMarkup(prevBlockStart, actionType);
              }
            } else {
              // Cursor was in the middle/end: apply normal type transition.
              // Fix the new block's type, and ensure the first block kept original type.
              const isNextBuiltIn = !!schema.nodes[nextType];
              if (isNextBuiltIn) {
                const newNodeType = schema.nodes[nextType];
                if (newNodeType && tr.doc.nodeAt(newBlockStart)?.type.name !== nextType) {
                  tr.setNodeMarkup(newBlockStart, newNodeType);
                }
              } else {
                // Custom element transition
                const customNodeType = schema.nodes['customElement'];
                const nextRule = activeTemplate.rules[nextType];
                if (customNodeType && nextRule) {
                  tr.setNodeMarkup(newBlockStart, customNodeType, {
                    customTypeId: nextType,
                    customLabel: nextRule.label,
                  });
                }
              }
              const prevResolved = tr.doc.resolve(newBlockStart - 1);
              const prevBlockStart = prevResolved.before(prevResolved.depth);
              const origNodeType = schema.nodes[currentType] || schema.nodes['customElement'];
              if (origNodeType && tr.doc.nodeAt(prevBlockStart)?.type.name !== currentType) {
                if (schema.nodes[currentType]) {
                  tr.setNodeMarkup(prevBlockStart, schema.nodes[currentType]);
                }
                // For customElement, the type is already correct from splitBlock
              }
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

  // Centralized Tab handler — reads nextOnTab from active template
  const [TabHandlerExtension] = React.useState(() =>
    Extension.create({
      name: 'tabHandler',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Tab: ({ editor }) => {
            const { $from } = editor.state.selection;
            const currentNode = $from.parent;
            const currentType = currentNode.type.name;

            // For custom elements, look up by customTypeId
            const effectiveType = currentType === 'customElement'
              ? (currentNode.attrs?.customTypeId || currentType)
              : currentType;

            const templateStore = useFormattingTemplateStore.getState();
            const activeTemplate = templateStore.getActiveTemplate();
            const rule = activeTemplate.rules[effectiveType];

            if (!rule?.nextOnTab) return false;

            const nextId = rule.nextOnTab;
            // Check if next type is a built-in or custom element
            const isBuiltIn = ALL_ELEMENT_TYPES.includes(nextId as ElementType);

            if (isBuiltIn) {
              return editor.chain().splitBlock().setNode(nextId).run();
            } else {
              // Custom element
              const nextRule = activeTemplate.rules[nextId];
              if (nextRule) {
                return editor.chain().splitBlock().setNode('customElement', {
                  customTypeId: nextId,
                  customLabel: nextRule.label,
                }).run();
              }
            }
            return false;
          },
        };
      },
    })
  );

  // Build collaboration extensions when in collab mode
  const collabExtensions = useMemo(() => {
    if (!collabMode || !ydocRef.current || !providerRef.current) {
      return [];
    }
    return [
      Collaboration.configure({
        document: ydocRef.current,
      }),
      CollaborationCursor.configure({
        provider: providerRef.current,
        user: { name: collabUserName, color: collabColor },
      }),
    ];
  }, [collabMode, collabUserName, collabColor, editorKey]);

  const editor = useEditor({
    extensions: [
      Document.extend({
        content: 'block+',
      }),
      Text, Bold, Italic, Underline, Strike, Dropcursor, Gapcursor,
      Subscript, Superscript,
      Highlight.configure({ multicolor: true }),
      TextStyle, Color, FontFamily, FontSize,
      FormatOverride, CustomElement,
      // Use History in normal mode, Collaboration in collab mode
      ...(collabMode ? collabExtensions : [History]),
      TextAlign.configure({ types: [...ALL_ELEMENT_TYPES, 'customElement'] }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          // Check template rules first for custom placeholders
          const tplStore = useFormattingTemplateStore.getState();
          const tpl = tplStore.getActiveTemplate();
          // For custom elements, use customTypeId attribute
          if (node.type.name === 'customElement') {
            const customTypeId = node.attrs?.customTypeId;
            if (customTypeId && tpl.rules[customTypeId]) {
              return tpl.rules[customTypeId].placeholder || '';
            }
            return '';
          }
          // For built-in elements, check template rule
          if (tpl.rules[node.type.name]?.placeholder) {
            return tpl.rules[node.type.name].placeholder;
          }
          // Fallback defaults
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
      TrackChangesExtension,
      ...(isHistoryMode ? [] : [EnterHandlerExtension, TabHandlerExtension]),
      SpellCheck,
      ...pluginRegistry.getEditorExtensions(),
    ],
    // In collab mode, pass fetched content so TipTap seeds the Yjs doc on first connect.
    // For normal editing from URL, content is loaded later via useEffect.
    content: collabMode
      ? (collabInitialContent.current || { type: 'doc', content: [{ type: 'action', content: [] }] })
      : (urlScriptId || urlCommitHash) ? undefined : { type: 'doc', content: [{ type: 'action', content: [] }] },
    editable: !isHistoryMode && !(collabMode && collabRole === 'viewer'),
    editorProps: {
      attributes: { class: `screenplay-content${isHistoryMode ? ' history-readonly' : ''}`, spellcheck: isHistoryMode ? 'false' : 'true' },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // Check custom element first
      if (ed.isActive('customElement')) {
        // Use customTypeId as the active element label
        const attrs = ed.getAttributes('customElement');
        if (attrs?.customTypeId) {
          setActiveElement(attrs.customTypeId as ElementType);
          return;
        }
      }
      for (const type of ALL_ELEMENT_TYPES) {
        if (ed.isActive(type)) { setActiveElement(type); break; }
      }
    },
  }, [editorKey]);

  // Keep editor ref updated for onSynced callback
  collabEditorRef.current = editor;

  // ── Dynamic CSS injection for custom formatting templates ──
  const formattingMode = useFormattingTemplateStore((s) => s.formattingMode);
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);
  const defaultTemplateId = useFormattingTemplateStore((s) => s.defaultTemplateId);
  const templatesLoaded = useFormattingTemplateStore((s) => s.loaded);

  useEffect(() => {
    // Load templates on mount
    useFormattingTemplateStore.getState().loadTemplates();
  }, []);

  useEffect(() => {
    const template = useFormattingTemplateStore.getState().getActiveTemplate();
    // If the resolved template is industry standard, use static CSS
    if (template.id === '__industry_standard__') {
      injectTemplateCss(null);
      return;
    }
    const pageLayout = useEditorStore.getState().pageLayout;
    const css = generateTemplateCss(template, pageLayout);
    injectTemplateCss(css);

    return () => { injectTemplateCss(null); };
  }, [formattingMode, activeTemplateId, defaultTemplateId, templatesLoaded]);

  // ── Owner starts collaboration — save current content, create own token, switch to collab mode ──
  const handleStartCollab = useCallback(async (guestSession: import('../services/api').CollabSession) => {
    if (!editor || !currentProject || !currentScriptId) return;

    // Save current editor content so it can seed the Yjs doc
    const doc = editor.getJSON();
    const { _notes, _generalNotes: _gn3, _tags, _tagCategories, _characterProfiles, _templateId: _tpl3, ...pmDoc } = doc as Record<string, unknown>;
    collabInitialContent.current = pmDoc;

    // The guest invite carries a session_nonce that makes the Yjs room unique
    // per collab session, so stale state from previous sessions is never loaded.
    const nonce = guestSession.session_nonce || '';

    // Create a separate session token for the owner, sharing the same nonce
    let ownerToken: string;
    try {
      const ownerSession = await api.createCollabInvite(
        currentProject.id, currentScriptId, 'Host', 'editor', 1, nonce,
      );
      ownerToken = ownerSession.token;
    } catch {
      ownerToken = guestSession.token;
    }

    // Include the nonce in the room name so each session gets a fresh Yjs document
    const docName = `${currentProject.id}/${currentScriptId}/${nonce}`;
    // Use the logged-in user's display name so remote users see the real name
    const hostDisplayName = useSettingsStore.getState().collabAuth.user?.displayName || 'Host';
    setupCollab(docName, ownerToken, hostDisplayName, true);

    setCollabUserName(hostDisplayName);
    setIsCollabHost(true);
    setCollabMode(true);
    // Keep ShareDialog open so the host can immediately copy the invite link
    setEditorKey((k) => k + 1);
  }, [editor, currentProject, currentScriptId, setupCollab]);

  // Helper: clear track changes when switching documents
  const clearTrackChanges = useCallback(() => {
    const store = useEditorStore.getState();
    if (!store.trackChangesEnabled) return;
    store.setTrackChangesEnabled(false);
    store.setTrackChangesLabel('');
    if (editor) {
      const { tr } = editor.state;
      tr.setMeta(trackChangesPluginKey, { enabled: false, baseline: null });
      editor.view.dispatch(tr);
    }
  }, [editor]);

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
    // Only update character list when the cursor leaves a character node
    // (i.e., user finished typing the name and pressed Enter / moved away)
    let prevInCharNode = false;
    const handleSelectionUpdate = () => {
      const { $from } = editor.state.selection;
      const inCharNode = $from.parent.type.name === 'character';
      // Update when leaving a character node, or when entering a non-character node after being in one
      if (prevInCharNode && !inCharNode) {
        updateCharacters();
      }
      prevInCharNode = inCharNode;
    };
    // Also update on transaction that changes node type (e.g., setNode from character to dialogue)
    const handleUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const { $from } = editor.state.selection;
      if ($from.parent.type.name !== 'character') {
        updateCharacters();
      }
    };
    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('update', handleUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('update', handleUpdate);
    };
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
    spellChecker.init().catch(() => {});
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
    const tplStore = useFormattingTemplateStore.getState();
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
      _templateId: tplStore.activeTemplateId,
    };
  }, [editor]);

  // --- Auto-save to backend every 30 seconds if a project/script is active ---
  // Skip for collab guests — they don't own the document and the project may
  // not exist on their local backend.
  const lastSavedJsonRef = useRef<string>('');
  const isCollabGuest = collabMode && !isCollabHost;
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId || isCollabGuest) return;
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
  }, [editor, currentProject, currentScriptId, buildSaveContent, isCollabGuest]);

  // --- Save on page unload (refresh / close) ---
  // Uses api.saveScript so it works on both web/desktop (HTTP) and mobile (SQLite).
  // NOTE: We intentionally do NOT save on component unmount because the
  // editor may already be destroyed at that point, and editor.getJSON()
  // would return an empty doc, overwriting the saved file with blank content.
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId || isCollabGuest) return;
    const pid = currentProject.id;
    const sid = currentScriptId;
    const handleBeforeUnload = () => {
      if (editor.isDestroyed) return;
      const content = buildSaveContent();
      const json = JSON.stringify(content);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        api.saveScript(pid, sid, { content }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editor, currentProject, currentScriptId, buildSaveContent, isCollabGuest]);

  // --- Load script from URL params ---
  // Reset the guard when the editor instance changes so we reload
  // content if TipTap recreates the editor.
  const loadedScriptRef = useRef<string | null>(null);
  const [historyVersionLabel, setHistoryVersionLabel] = useState('');
  useEffect(() => {
    // Allow re-load for new editor instance, but NOT during collab —
    // switchCollabDocument already handles content seeding via collabInitialContent.
    // Resetting the guard during collab caused the normal load path to run and
    // create duplicate setupCollab calls with different nonces.
    if (editor && !collabMode) {
      loadedScriptRef.current = null;
    }
  }, [editor, collabMode]);
  // Reset load guard when a version is restored so the editor refetches the content
  useEffect(() => {
    if (scriptReloadKey > 0) {
      loadedScriptRef.current = null;
    }
  }, [scriptReloadKey]);
  useEffect(() => {
    if (!editor || !urlProjectId || !urlScriptId) return;
    const loadKey = `${urlProjectId}/${urlScriptId}${urlCommitHash ? `@${urlCommitHash}` : ''}`;
    // Avoid reloading the same script
    if (loadedScriptRef.current === loadKey) return;

    // Host switching documents during collab — redirect through switchCollabDocument
    if (collabMode && isCollabHost && !isHistoryMode) {
      const isNewScript = currentScriptId && currentScriptId !== urlScriptId;
      if (isNewScript) {
        loadedScriptRef.current = loadKey;
        switchCollabDocument(urlProjectId, urlScriptId);
        return;
      }
    }

    loadedScriptRef.current = loadKey;
    clearTrackChanges();
    (async () => {
      try {
        const project = await api.getProject(urlProjectId);
        setCurrentProject(project);
        setCurrentScriptId(isHistoryMode ? null : urlScriptId);

        let scriptResp;
        if (isHistoryMode && urlCommitHash) {
          scriptResp = await api.getScriptAtVersion(urlProjectId, urlCommitHash, urlScriptId);
          setHistoryVersionLabel(urlCommitHash.slice(0, 7));
        } else {
          scriptResp = await api.getScript(urlProjectId, urlScriptId);
        }
        const content = scriptResp.content as Record<string, unknown> | null;

        // Strip app metadata keys before feeding to ProseMirror
        let pmDoc: Record<string, unknown> | null = null;
        if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
          const { _notes, _generalNotes: _gn, _tags, _tagCategories, _characterProfiles, _beats, _beatColumns, _beatArrangeMode, _templateId: _tpl, ...rest } = content as any;
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

        // Restore metadata from top-level content keys (skip in history mode)
        if (!isHistoryMode) {
          const store = useEditorStore.getState();
          // Clear per-screenplay metadata so we don't carry over from a previously opened screenplay
          store.setCharacterProfiles([]);
          store.setNotes([]);
          store.setGeneralNotes([]);
          store.setTags([]);
          store.setTagCategories([]);
          store.setBeats([]);
          store.setBeatColumns([]);
          const parseAttr = (val: unknown): unknown[] => {
            if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
            if (Array.isArray(val)) return val;
            return [];
          };
          if (content) {
            const c = content as Record<string, unknown>;
            const notes = parseAttr(c._notes);
            if (notes.length > 0) store.setNotes(notes as import('../stores/editorStore').NoteInfo[]);
            const gNotes = parseAttr(c._generalNotes);
            if (gNotes.length > 0) store.setGeneralNotes(gNotes as import('../stores/editorStore').GeneralNote[]);
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
                    role: (prof.role as string) || '',
                    backstory: (prof.backstory as string) || '',
                    images: Array.isArray(prof.images) ? (prof.images as string[]) : [],
                  });
                }
              }
            }
            const beatsArr = parseAttr(c._beats);
            store.setBeats(beatsArr as import('../stores/editorStore').BeatInfo[]);
            const beatColsArr = parseAttr(c._beatColumns);
            store.setBeatColumns(beatColsArr as import('../stores/editorStore').BeatColumn[]);
            if (c._beatArrangeMode === 'auto' || c._beatArrangeMode === 'custom') {
              store.setBeatArrangeMode(c._beatArrangeMode);
            }
            // Restore per-document formatting template
            if (c._templateId && typeof c._templateId === 'string') {
              useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
            } else {
              useFormattingTemplateStore.getState().setActiveTemplateId(null);
            }
          }
        }

        setDocumentTitle(scriptResp.meta.title);
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to load script:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        // If the script doesn't exist (404), redirect to the project view
        if (errMsg.includes('404') && urlProjectId) {
          showToast('Script not found. It may have been removed by a version restore.', 'error');
          navigate(`/project/${urlProjectId}`, { replace: true });
        } else {
          showToast(`Failed to load script: ${errMsg}`, 'error');
        }
      }
    })();
  }, [editor, urlProjectId, urlScriptId, urlCommitHash, isHistoryMode, collabMode, collabUserName, currentScriptId, switchCollabDocument, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes, scriptReloadKey, navigate]);

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
          id: o.tagId, categoryId: o.categoryId, name: o.text, text: o.text, notes: '',
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

      // Host switching documents during collab
      if (collabMode && isCollabHost) {
        await switchCollabDocument(projectId, scriptId);
        return;
      }

      clearTrackChanges();
      try {
        const scriptResp = await api.getScript(projectId, scriptId);
        const content = scriptResp.content as Record<string, unknown> | null;

        try {
          if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
            const { _notes, _generalNotes: _gn2, _tags, _tagCategories, _characterProfiles, _beats, _beatColumns, _beatArrangeMode: _bam, _templateId: _tpl2, ...pmDoc } = content as any;
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
        // Clear all per-file metadata first
        store.setCharacterProfiles([]);
        store.setNotes([]);
        store.setGeneralNotes([]);
        store.setTags([]);
        store.setTagCategories([]);
        store.setBeats([]);
        store.setBeatColumns([]);
        const parseAttr2 = (val: unknown): unknown[] => {
          if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
          if (Array.isArray(val)) return val;
          return [];
        };
        if (content) {
          const c = content as Record<string, unknown>;
          const notes2 = parseAttr2(c._notes);
          if (notes2.length > 0) store.setNotes(notes2 as import('../stores/editorStore').NoteInfo[]);
          const gNotes2 = parseAttr2(c._generalNotes);
          if (gNotes2.length > 0) store.setGeneralNotes(gNotes2 as import('../stores/editorStore').GeneralNote[]);
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
          const beatsArr2 = parseAttr2(c._beats);
          store.setBeats(beatsArr2 as import('../stores/editorStore').BeatInfo[]);
          const beatCols2 = parseAttr2(c._beatColumns);
          store.setBeatColumns(beatCols2 as import('../stores/editorStore').BeatColumn[]);
          // Restore per-document template
          if (c._templateId && typeof c._templateId === 'string') {
            useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
          } else {
            useFormattingTemplateStore.getState().setActiveTemplateId(null);
          }
        }
        setCurrentProject(project);
        setCurrentScriptId(scriptId);
        setDocumentTitle(scriptTitle);
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to open script:', err);
        showToast('Failed to open script. Make sure the backend server is running on port 8000.', 'error');
      }
    },
    [editor, collabMode, collabUserName, switchCollabDocument, setOpenFromProjectOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes],
  );

  const handleWelcomeChoice = useCallback(async (choice: WelcomeChoice) => {
    setShowWelcome(false);
    localStorage.setItem('opendraft:welcomed', 'true');

    if (choice === 'sample') {
      editor?.commands.setContent(SAMPLE_CONTENT, true);
    } else if (choice === 'import') {
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
        if (parsed.beats.length > 0) {
          const store = useEditorStore.getState();
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) {
            store.setBeatColumns(parsed.beatColumns);
          }
        }
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
      editor.commands.setContent(doc, true);
      const scriptTitle = name.replace(/\.\w+$/, '') || 'Untitled';
      useEditorStore.getState().setDocumentTitle(scriptTitle);
    }
    // 'blank' — editor already has empty content, nothing to do
  }, [editor]);

  // ── File association: open files passed by the OS ──────────────────────
  const handleExternalFile = useCallback(async (filePath: string) => {
    if (!editor) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const text = await invoke<string>('read_text_file', { path: filePath });

      const ext = filePath.split('.').pop()?.toLowerCase();
      const filename = filePath.replace(/^.*[\\/]/, '') || 'Untitled';
      const title = filename.replace(/\.\w+$/, '');

      let doc: any;
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
        if (parsed.beats.length > 0) {
          const store = useEditorStore.getState();
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) store.setBeatColumns(parsed.beatColumns);
        }
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
          for (const [, hl] of highlightMap) {
            store.upsertCharacterProfile(hl.name, { color: hl.color, highlighted: hl.highlighted });
          }
        }
      } else if (ext === 'odraft') {
        const parsed = parseOdraft(text);
        doc = parsed.content;
        if (parsed.meta.title) {
          setDocumentTitle(parsed.meta.title);
          setShowWelcome(false);
          setCurrentProject(null);
          setCurrentScriptId(null);
          editor.commands.setContent(doc, true);
          return;
        }
      } else {
        // .fountain, .txt — parse as Fountain
        doc = parseFountain(text);
      }

      editor.commands.setContent(doc, true);
      setDocumentTitle(title);
      setShowWelcome(false);
      // Clear project context — this is a standalone opened file
      setCurrentProject(null);
      setCurrentScriptId(null);
    } catch (err) {
      console.error('Failed to open external file:', err);
      showToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, setDocumentTitle, setCurrentProject, setCurrentScriptId]);

  useEffect(() => {
    if (!editor) return;

    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    (async () => {
      const { isTauri } = await import('../services/platform');
      if (!isTauri() || cancelled) return;

      // Check for a file passed at launch (CLI args or early RunEvent::Opened)
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pending = await invoke<string | null>('get_opened_file');
        if (pending && !cancelled) {
          handleExternalFile(pending);
        }
      } catch (err) {
        console.error('get_opened_file failed:', err);
      }

      // Listen for files opened while the app is already running
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<string>('open-file', (event) => {
          if (!cancelled) handleExternalFile(event.payload);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch (err) {
        console.error('Failed to listen for open-file events:', err);
      }
    })();

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [editor, handleExternalFile]);

  // ── Drag-and-drop file import ─────────────────────────────────────────
  const IMPORTABLE_EXTENSIONS = ['fdx', 'fountain', 'odraft', 'txt'];

  const hasUnsavedChanges = useCallback((): boolean => {
    if (!editor || !currentProject || !currentScriptId) return false;
    const content = buildSaveContent();
    if (!content) return false;
    const json = JSON.stringify(content);
    return json !== lastSavedJsonRef.current && lastSavedJsonRef.current !== '';
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  const importDroppedFile = useCallback(async (file: File) => {
    if (!editor) return;
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      const title = file.name.replace(/\.\w+$/, '') || 'Untitled';

      let doc: any;
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
        if (parsed.beats.length > 0) {
          const store = useEditorStore.getState();
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) store.setBeatColumns(parsed.beatColumns);
        }
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
          for (const [, hl] of highlightMap) {
            store.upsertCharacterProfile(hl.name, { color: hl.color, highlighted: hl.highlighted });
          }
        }
      } else if (ext === 'odraft') {
        const parsed = parseOdraft(text);
        doc = parsed.content;
        if (parsed.meta.title) {
          setDocumentTitle(parsed.meta.title);
          setCurrentProject(null);
          setCurrentScriptId(null);
          editor.commands.setContent(doc, true);
          setShowWelcome(false);
          return;
        }
      } else {
        doc = parseFountain(text);
      }

      editor.commands.setContent(doc, true);
      setDocumentTitle(title);
      setCurrentProject(null);
      setCurrentScriptId(null);
      setShowWelcome(false);
    } catch (err) {
      console.error('Failed to import dropped file:', err);
      showToast(`Failed to import file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, setDocumentTitle, setCurrentProject, setCurrentScriptId]);

  const handleEditorDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverEditor(true);
  }, []);

  const handleEditorDragLeave = useCallback((e: React.DragEvent) => {
    // Only close if leaving the editor-main container itself
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverEditor(false);
  }, []);

  const handleEditorDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverEditor(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !IMPORTABLE_EXTENSIONS.includes(ext)) {
      showToast('Unsupported file type. Drop a .fdx, .fountain, .odraft, or .txt file.', 'error');
      return;
    }

    if (hasUnsavedChanges()) {
      setPendingDropFile(file);
      setDropConfirmOpen(true);
    } else {
      importDroppedFile(file);
    }
  }, [hasUnsavedChanges, importDroppedFile]);

  const handleDropConfirmSave = useCallback(async () => {
    // Save current content first, then import
    if (editor && currentProject && currentScriptId) {
      const content = buildSaveContent();
      if (content) {
        try {
          await api.saveScript(currentProject.id, currentScriptId, { content });
          lastSavedJsonRef.current = JSON.stringify(content);
        } catch (err) {
          showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    }
    setDropConfirmOpen(false);
    if (pendingDropFile) {
      importDroppedFile(pendingDropFile);
      setPendingDropFile(null);
    }
  }, [editor, currentProject, currentScriptId, buildSaveContent, pendingDropFile, importDroppedFile]);

  const handleDropConfirmDiscard = useCallback(() => {
    setDropConfirmOpen(false);
    if (pendingDropFile) {
      importDroppedFile(pendingDropFile);
      setPendingDropFile(null);
    }
  }, [pendingDropFile, importDroppedFile]);

  const handleDropConfirmCancel = useCallback(() => {
    setDropConfirmOpen(false);
    setPendingDropFile(null);
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
        // Navigate to the project edit route so URL reflects project context
        navigate(`/project/${projectId}/edit/${scriptId}`, { replace: true });
        showToast('Saved', 'success');
      } catch (err) {
        console.error('Failed to finalize save:', err);
      }
      // Run deferred action (e.g. import) that was waiting for save-as to finish
      const store = useEditorStore.getState();
      if (store.postSaveAction) {
        const action = store.postSaveAction;
        store.setPostSaveAction(null);
        action();
      }
    },
    [setSaveAsOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle, navigate],
  );


  // ── Compare with Version picker callback ──
  const handleCompareVersionSelect = useCallback(
    async (version: VersionInfo) => {
      if (!editor || !currentProject || !currentScriptId) return;
      setCompareVersionOpen(false);
      try {
        const scriptResp = await api.getScriptAtVersion(
          currentProject.id,
          version.hash,
          currentScriptId,
        );
        setTrackChangesEnabled(true);
        setTrackChangesLabel(version.short_hash);
        const { tr } = editor.state;
        tr.setMeta(trackChangesPluginKey, {
          enabled: true,
          baseline: scriptResp.content,
        });
        editor.view.dispatch(tr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('404')) {
          showToast('This script did not exist in that version', 'info');
        } else {
          showToast('Failed to load version for comparison', 'error');
        }
      }
    },
    [editor, currentProject, currentScriptId, setCompareVersionOpen, setTrackChangesEnabled, setTrackChangesLabel],
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
  // Only opens the panel when note highlights are visible (notesVisible).
  // When highlights are off, clicks pass through as normal editing.
  useEffect(() => {
    if (!editor) return;
    const handleClick = (e: MouseEvent) => {
      const store = useEditorStore.getState();
      // Only intercept clicks when highlights are visible
      if (!store.notesVisible) return;

      const target = e.target as HTMLElement;
      const noteEl = target.closest('.script-note-highlight') as HTMLElement | null;
      if (!noteEl) return;

      const noteId = noteEl.getAttribute('data-note-id');
      if (!noteId) return;

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

  // --- Click on character element → expand in character panel ---
  useEffect(() => {
    if (!editor) return;
    const handleCharClick = (e: MouseEvent) => {
      const store = useEditorStore.getState();
      if (!store.characterProfilesOpen) return;

      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) return;

      const resolved = editor.state.doc.resolve(pos.pos);
      const node = resolved.parent;

      if (node.type.name === 'character') {
        const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
        if (base) {
          store.setSelectedCharacter(base);
        }
      }
    };

    const editorEl = editor.view.dom;
    editorEl.addEventListener('click', handleCharClick);
    return () => editorEl.removeEventListener('click', handleCharClick);
  }, [editor]);

  // --- Script context menu (right-click) ---
  useEffect(() => {
    if (!editor) return;
    const isTouchDevice = navigator.maxTouchPoints > 0;
    const handleContextMenu = (e: MouseEvent) => {
      const editorDom = editor.view.dom;
      if (!editorDom.contains(e.target as Node)) return;
      e.preventDefault();
      // No context menu on touch devices — use 3-finger touch instead
      if (isTouchDevice) return;

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

  // Show loading screen while collab session is being set up
  if (collabLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--fd-text-secondary, #888)' }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Joining collaboration session...</div>
          <div style={{ fontSize: 13 }}>Loading document</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container${isHistoryMode ? ' history-mode' : ''}`}>
      {isHistoryMode && (
        <div className="history-banner">
          <span className="history-banner-icon">&#128337;</span>
          <span className="history-banner-text">
            Viewing version <strong>{historyVersionLabel}</strong> — Read Only
          </span>
          <button
            className="history-banner-back"
            onClick={() => {
              if (urlProjectId && urlScriptId) {
                navigate(`/project/${urlProjectId}/edit/${urlScriptId}`);
              } else {
                navigate(-1);
              }
            }}
          >
            Back to Current Version
          </button>
        </div>
      )}
      {collabMode && (
        <div className="collab-banner">
          <span className="collab-dot" />
          <span className="collab-banner-text">
            Live Collaboration — {collabRole === 'viewer' ? 'Read Only' : 'Editing'} as <strong>{collabUserName}</strong>
            {collabUsers.length > 0 && ` — ${collabUsers.length} user${collabUsers.length !== 1 ? 's' : ''} connected`}
          </span>
          <div className="collab-avatars">
            {collabUsers.map((u, i) => (
              <span
                key={i}
                className="collab-avatar"
                style={{ backgroundColor: u.color, cursor: 'pointer' }}
                title={`Click to jump to ${u.name}'s cursor`}
                onClick={() => {
                  // Find the collaboration cursor label matching this user and scroll to it
                  const labels = document.querySelectorAll('.collaboration-cursor__label');
                  for (const label of labels) {
                    if (label.textContent === u.name) {
                      const caret = label.closest('.collaboration-cursor__caret');
                      if (caret) {
                        caret.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                      return;
                    }
                  }
                }}
              >
                {u.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          {isCollabHost && (
            <button className="collab-banner-btn" onClick={() => {
              if (!isCollabAuthenticated()) {
                setCollabLoginOpen(true);
                return;
              }
              setShareDialogOpen(true);
            }}>
              Invite
            </button>
          )}
          <button className="collab-banner-btn collab-banner-btn-stop" onClick={handleStopCollab}>
            {isCollabHost ? 'End Session' : 'Disconnect'}
          </button>
        </div>
      )}
      {!isHistoryMode && <MenuBar editor={editor} onCollaborate={() => {
        if (!currentProject || !currentScriptId) {
          showToast('Save your screenplay to a project first — opening Save As...', 'info');
          useEditorStore.getState().setSaveAsOpen(true);
          return;
        }
        // Check if user is authenticated to the collab server (also clears expired tokens)
        if (!isCollabAuthenticated()) {
          setCollabLoginOpen(true);
          return;
        }
        setShareDialogOpen(true);
      }} onJoinCollab={() => setJoinCollabOpen(true)} isCollabActive={collabMode} isCollabGuest={collabMode && !isCollabHost} />}
      {!isHistoryMode && <Toolbar editor={editor} />}
      <div className="editor-layout">
        {!isHistoryMode && <SceneNavigator editor={editor} scrollContainer={editorMainRef.current} style={{ width: navWidth, minWidth: navWidth }} />}
        {!isHistoryMode && navigatorOpen && (
          <div className="panel-resize-handle" onPointerDown={(e) => handleResizePointerDown('left', e)} style={{ touchAction: 'none' }} />
        )}
        <div className="editor-center">
          {!isHistoryMode && <IndexCards editor={editor} scrollContainer={editorMainRef.current} />}
          {!isHistoryMode && beatBoardOpen ? (
            <BeatBoard />
          ) : (
            <div className="editor-main" ref={editorMainRef} onDragOver={handleEditorDragOver} onDragLeave={handleEditorDragLeave} onDrop={handleEditorDrop}>
              <div
                className="page-sizer"
                style={{
                  width: `calc(${pageLayout.pageWidth}in * ${zoomScale})`,
                  minWidth: `calc(${pageLayout.pageWidth}in * ${zoomScale})`,
                }}
              >
              <div
                className="page-container"
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top left',
                  width: `${pageLayout.pageWidth}in`,
                  minWidth: `${pageLayout.pageWidth}in`,
                  maxWidth: `${pageLayout.pageWidth}in`,
                }}
              >
                <div
                  className={`page${!tagsVisible ? ' tags-hidden' : ''}${!notesVisible ? ' notes-hidden' : ''}${isHistoryMode ? ' history-readonly' : ''}`}
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
            </div>
          )}
        </div>
        {!isHistoryMode && rightPanelVisible && (
          <div className="panel-resize-handle" onPointerDown={(e) => handleResizePointerDown('right', e)} style={{ touchAction: 'none' }} />
        )}
        {!isHistoryMode && <ScriptNotes editor={editor} style={{ width: rightPanelWidth, minWidth: rightPanelWidth }} />}
        {!isHistoryMode && <CharacterProfiles editor={editor} projectId={currentProject?.id || ''} style={{ width: rightPanelWidth, minWidth: rightPanelWidth }} />}
        {!isHistoryMode && <TagsPanel editor={editor} style={{ width: rightPanelWidth, minWidth: rightPanelWidth }} />}
        {!isHistoryMode && pluginRegistry.getPanels('right-sidebar').map((p) => (
          <p.component key={p.id} editor={editor} />
        ))}
      </div>
      {!isHistoryMode && <StatusBar />}
      {!isHistoryMode && <SearchReplace editor={editor} />}
      {!isHistoryMode && <GoToPage onGoToPage={handleGoToPage} />}
      <ZoomPanel />
      {!isHistoryMode && pickerState.visible && (
        <ElementPicker
          position={pickerState.position}
          defaultType={pickerState.defaultType}
          onSelect={handlePickerSelect}
          onDismiss={handlePickerDismiss}
        />
      )}
      {!isHistoryMode && charAutoState.visible && !pickerState.visible && (
        <CharacterAutocomplete
          position={charAutoState.position}
          suggestions={charAutoState.suggestions}
          onSelect={handleCharAutoSelect}
          onDismiss={handleCharAutoDismiss}
        />
      )}
      {/* Context menu on mobile: 3-finger touch only */}
      {!isHistoryMode && ctxMenuState.visible && editor && (
        <ScriptContextMenu
          editor={editor}
          position={ctxMenuState.position}
          spellInfo={ctxMenuState.spellInfo}
          onClose={handleCtxMenuClose}
          onOpenFormatPanel={() => setFormatPanelOpen(true)}
          overrideSelection={ctxMenuState.savedSelection}
        />
      )}
      {!isHistoryMode && formatPanelOpen && editor && (
        <FormatPanel editor={editor} onClose={() => setFormatPanelOpen(false)} />
      )}
      {!isHistoryMode && spellModalOpen && editor && (
        <SpellCheckModal
          editor={editor}
          onClose={() => setSpellModalOpen(false)}
        />
      )}
      {!isHistoryMode && <VersionHistory />}
      {!isHistoryMode && currentProject && <AssetManager projectId={currentProject.id} />}
      {!isHistoryMode && openFromProjectOpen && (
        <OpenFromProject
          onOpen={handleOpenFromProject}
          onClose={() => setOpenFromProjectOpen(false)}
        />
      )}
      {!isHistoryMode && showWelcome && <WelcomeDialog onChoice={handleWelcomeChoice} />}
      {!isHistoryMode && saveAsOpen && (
        <SaveAsDialog
          defaultProjectName={currentProject?.name || 'My Project'}
          defaultFileName={useEditorStore.getState().documentTitle || 'First Draft'}
          onSaved={handleSaveAsComplete}
          onClose={() => setSaveAsOpen(false)}
          buildContent={buildSaveContent}
        />
      )}
      {!isHistoryMode && compareVersionOpen && (
        <CompareVersionPicker
          onSelect={handleCompareVersionSelect}
          onClose={() => setCompareVersionOpen(false)}
        />
      )}
      {!isHistoryMode && shareDialogOpen && currentProject && currentScriptId && (
        <ShareDialog
          projectId={currentProject.id}
          scriptId={currentScriptId}
          scriptTitle={useEditorStore.getState().documentTitle}
          isCollabActive={collabMode}
          onStartCollab={handleStartCollab}
          onClose={() => setShareDialogOpen(false)}
        />
      )}
      {collabLoginOpen && (
        <CollabLoginDialog
          onClose={() => setCollabLoginOpen(false)}
          onSuccess={() => {
            setCollabLoginOpen(false);
            setShareDialogOpen(true);
          }}
        />
      )}
      {joinCollabOpen && (
        <JoinCollabDialog
          onJoin={handleJoinCollab}
          onClose={() => setJoinCollabOpen(false)}
        />
      )}
      {dragOverEditor && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(37,99,235,.15)',
          border: '3px dashed var(--fd-accent, #2563eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'var(--fd-bg)', padding: '20px 32px', borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,.3)', fontSize: 16, fontWeight: 600,
            color: 'var(--fd-text)',
          }}>
            Drop screenplay file to open
          </div>
        </div>
      )}
      {dropConfirmOpen && (
        <div className="dialog-overlay" onClick={handleDropConfirmCancel}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Unsaved Changes</div>
            <div className="dialog-body">
              <p style={{ margin: 0, fontSize: 14, color: 'var(--fd-text)' }}>
                You have unsaved changes. Would you like to save before opening the new file?
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={handleDropConfirmCancel}>Cancel</button>
              <button onClick={handleDropConfirmDiscard}>Discard</button>
              <button className="dialog-primary" onClick={handleDropConfirmSave}>Save &amp; Open</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenplayEditor;
