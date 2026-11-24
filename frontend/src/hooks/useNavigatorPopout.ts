import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { getLanguage, subscribeLanguage, t } from '../i18n';
import { sceneSummary, sameSceneSummary, navigationPosition, type PanelMessage, type PanelScene } from '../services/panelProtocol';
import { canPopOutNavigator, closeNavigatorPanels, openNavigatorPanel, publishNavigator, subscribePanel } from '../services/panelWindows';
import { showToast } from '../components/Toast';

export const NavigatorPopoutContext = createContext<{ detached: boolean; available: boolean; open: () => void }>({ detached: false, available: false, open: () => {} });

const documentReplacement = 'opendraft:panel-document-replacement';

export function notifyPanelDocumentReplacement(editor: Editor | null) {
  if (editor && !editor.isDestroyed) editor.view.dom.dispatchEvent(new Event(documentReplacement));
}

function navigatorWindowTitle(scriptTitle: string) {
  const navigator = t('menu:view.navigator');
  return scriptTitle.trim() ? `${navigator} — ${scriptTitle}` : navigator;
}

/** The owner remains the sole editor, undo history and persistence authority. */
export function useNavigatorPopout(editor: Editor | null, scriptId: string | null) {
  const [detached, setDetached] = useState(false);
  const openRef = useRef<() => void>(() => {});
  const replaceRef = useRef<(() => void) | null>(null);
  const previousScriptId = useRef(scriptId);
  useEffect(() => {
    setDetached(false);
    if (!editor || !canPopOutNavigator()) return;
    let session = crypto.randomUUID(), revision = 0, sequence = 0;
    let active = false, disposed = false, pending = false;
    let trigger: HTMLElement | null = null;
    let focusFrame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let positions: number[] = [];
    let scenes: ReturnType<typeof sceneSummary>['scenes'] = [];
    let summaryRevision = -1;
    let sceneRevision = 0;
    let lastSceneSequence = -1;
    let sentScenes: readonly PanelScene[] | undefined;
    const refreshSummary = () => {
      if (summaryRevision === revision) return;
      const { sceneNumbersVisible, sceneNumbersLocked } = useEditorStore.getState();
      const summary = sceneSummary(editor.state.doc, editor.state.selection.from, { visible: sceneNumbersVisible, locked: sceneNumbersLocked });
      positions = summary.positions;
      scenes = summary.scenes;
      summaryRevision = revision;
    };
    const publish = (force = false) => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!active || disposed || editor.isDestroyed) return;
      refreshSummary();
      const state = useEditorStore.getState();
      let activeScene = -1;
      positions.forEach((position, index) => { if (position - 1 <= editor.state.selection.from) activeScene = index; });
      const changed = !sentScenes || !sameSceneSummary(sentScenes, scenes);
      const includeScenes = force || changed;
      if (changed) sceneRevision++;
      const publishedSequence = ++sequence;
      if (includeScenes) {
        sentScenes = scenes;
        lastSceneSequence = publishedSequence;
      }
      void publishNavigator({ session, revision, sequence: publishedSequence, sceneRevision, title: state.documentTitle,
        windowTitle: navigatorWindowTitle(state.documentTitle),
        ...(includeScenes ? { scenes } : {}), active: activeScene, appearance: state.appearance, language: getLanguage() })
        .catch(error => {
          if (includeScenes && lastSceneSequence === publishedSequence) sentScenes = undefined;
          console.warn('[panels] snapshot unavailable:', error);
        });
    };
    const schedule = () => { if (active && !timer) timer = setTimeout(publish, 100); };
    const revealDock = () => {
      const state = useEditorStore.getState();
      if (!state.navigatorOpen) useEditorStore.setState({ navigatorOpen: true });
    };
    const close = () => {
      if (active) revealDock();
      active = false;
      setDetached(false);
      void closeNavigatorPanels(session).catch(error => console.warn('[panels] close unavailable:', error));
    };
    const onReplacement = () => {
      close();
      session = crypto.randomUUID();
      revision++;
      positions = [];
      sentScenes = undefined;
    };
    replaceRef.current = onReplacement;
    const editorDom = editor.view.dom;
    editorDom.addEventListener(documentReplacement, onReplacement);
    const onTransaction = ({ transaction: tr }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (tr.docChanged) revision++;
      if (tr.docChanged || tr.selectionSet) schedule();
    };
    const stopCommands = subscribePanel<PanelMessage>('panel-command', message => {
      if (!active || disposed || editor.isDestroyed || message?.session !== session) return;
      if (message.action?.kind === 'ready') { publish(true); return; }
      // Edits can shift positions before the next snapshot reaches the panel.
      refreshSummary();
      if (!sentScenes || !sameSceneSummary(sentScenes, scenes)) { publish(true); return; }
      const position = navigationPosition(message, session, sceneRevision, positions);
      if (position === null) { publish(true); return; }
      // A selection-only transaction: no document change or undo entry.
      editor.chain().setTextSelection(position).scrollIntoView().run();
      schedule();
    });
    const stopClosed = subscribePanel<{ session: string }>('panel-closed', message => {
      if (message?.session === session && active) {
        active = false;
        setDetached(false);
        revealDock();
        focusFrame = requestAnimationFrame(() => {
          if (disposed) return;
          const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>('[data-panel-popout-trigger], .ProseMirror');
          target?.focus();
        });
      }
    });
    const stopStore = useEditorStore.subscribe((state, previous) => {
      if (state.sceneNumbersVisible !== previous.sceneNumbersVisible || state.sceneNumbersLocked !== previous.sceneNumbersLocked) {
        revision++;
        schedule();
      }
      if (state.appearance !== previous.appearance || state.documentTitle !== previous.documentTitle) schedule();
    });
    const stopLanguage = subscribeLanguage(schedule);
    editor.on('transaction', onTransaction);
    openRef.current = () => {
      if (pending || disposed) return;
      pending = true;
      if (!active) trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const openingSession = session;
      const create = async () => {
        const ready = await Promise.all([stopCommands.ready, stopClosed.ready]);
        if (disposed || openingSession !== session) return null;
        if (!ready.every(Boolean)) throw new Error('Owner listeners unavailable');
        return openNavigatorPanel(openingSession, navigatorWindowTitle(useEditorStore.getState().documentTitle));
      };
      void create().then(label => {
        if (label === null) return;
        if (disposed || openingSession !== session) { void closeNavigatorPanels(openingSession); return; }
        active = true;
        setDetached(true);
        publish(true);
      }).catch(error => {
        console.warn('[panels] could not open Navigator:', error);
        if (!disposed && openingSession === session) showToast(t('story:popout.failed'), 'error');
      }).finally(() => { pending = false; });
    };
    return () => {
      disposed = true;
      if (active) revealDock();
      replaceRef.current = null;
      openRef.current = () => {};
      if (timer) clearTimeout(timer);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      editor.off('transaction', onTransaction);
      editorDom.removeEventListener(documentReplacement, onReplacement);
      stopCommands(); stopClosed(); stopStore(); stopLanguage();
      void closeNavigatorPanels(session).catch(error => console.warn('[panels] cleanup unavailable:', error));
    };
  }, [editor]);
  useEffect(() => {
    const previous = previousScriptId.current;
    previousScriptId.current = scriptId;
    // The first library save assigns an ID to the document already on screen.
    // File linking never changes this ID. Content replacement has its own event.
    if (previous !== null && previous !== scriptId) replaceRef.current?.();
  }, [scriptId]);
  const keepForSavedScript = useCallback((id: string) => {
    previousScriptId.current = id;
  }, []);
  const open = useCallback(() => openRef.current(), []);
  const available = !!editor && !editor.isDestroyed && canPopOutNavigator();
  return useMemo(() => ({ detached, available, open, keepForSavedScript }), [detached, available, open, keepForSavedScript]);
}
