import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ReplaceStep } from '@tiptap/pm/transform';
import { useEditorStore } from '../stores/editorStore';
import { getLanguage, subscribeLanguage, t } from '../i18n';
import { sceneSummary, navigationPosition, type PanelMessage } from '../services/panelProtocol';
import { canPopOutNavigator, closeNavigatorPanels, openNavigatorPanel, publishNavigator, subscribePanel } from '../services/panelWindows';
import { showToast } from '../components/Toast';

export const NavigatorPopoutContext = createContext<{ detached: boolean; available: boolean; open: () => void }>({ detached: false, available: false, open: () => {} });

/** The owner remains the sole editor, undo history and persistence authority. */
export function useNavigatorPopout(editor: Editor | null, documentIdentity: string): { detached: boolean; available: boolean; open: () => void } {
  const [detached, setDetached] = useState(false);
  const openRef = useRef<() => void>(() => {});
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
    const publish = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!active || disposed || editor.isDestroyed) return;
      if (summaryRevision !== revision) {
        const summary = sceneSummary(editor.state.doc, editor.state.selection.from);
        positions = summary.positions;
        scenes = summary.scenes;
        summaryRevision = revision;
      }
      let activeScene = -1;
      positions.forEach((position, index) => { if (position - 1 <= editor.state.selection.from) activeScene = index; });
      const state = useEditorStore.getState();
      void publishNavigator({ session, revision, sequence: ++sequence, title: state.documentTitle,
        scenes, active: activeScene, appearance: state.appearance, language: getLanguage() })
        .catch(error => console.warn('[panels] snapshot unavailable:', error));
    };
    const schedule = () => { if (active && !timer) timer = setTimeout(publish, 100); };
    const close = () => {
      active = false;
      setDetached(false);
      void closeNavigatorPanels(session).catch(error => console.warn('[panels] close unavailable:', error));
    };
    const onTransaction = ({ transaction: tr }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (tr.docChanged) {
        revision++;
        // Import/New/restore can replace a document while reusing the editor
        // and route. Never carry a panel across that document boundary.
        if (tr.steps.some(step => step instanceof ReplaceStep && step.from === 0 && step.to >= tr.before.content.size)) {
          close();
          session = crypto.randomUUID();
          revision = 0;
          positions = [];
          summaryRevision = -1;
        }
      }
      schedule();
    };
    const stopCommands = subscribePanel<PanelMessage>('panel-command', message => {
      if (!active || disposed || message?.session !== session) return;
      if (message.action?.kind === 'ready') { publish(); return; }
      const position = navigationPosition(message, session, revision, positions);
      if (position === null) { publish(); return; }
      // A selection-only transaction: no document change or undo entry.
      editor.chain().setTextSelection(position).scrollIntoView().run();
      schedule();
    });
    const stopClosed = subscribePanel<{ session: string }>('panel-closed', message => {
      if (message?.session === session && active) {
        active = false;
        setDetached(false);
        focusFrame = requestAnimationFrame(() => {
          if (disposed) return;
          const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>('[data-panel-popout-trigger], .ProseMirror');
          target?.focus();
        });
      }
    });
    const stopStore = useEditorStore.subscribe((state, previous) => {
      if (state.appearance !== previous.appearance || state.documentTitle !== previous.documentTitle) schedule();
    });
    const stopLanguage = subscribeLanguage(schedule);
    editor.on('transaction', onTransaction);
    openRef.current = () => {
      if (pending || disposed) return;
      pending = true;
      if (!active) trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const openingSession = session;
      void openNavigatorPanel(session).then(() => {
        if (disposed || openingSession !== session) { void closeNavigatorPanels(openingSession); return; }
        active = true;
        setDetached(true);
        publish();
      }).catch(error => {
        console.warn('[panels] could not open Navigator:', error);
        if (!disposed) showToast(t('story:popout.failed'), 'error');
      }).finally(() => { pending = false; });
    };
    return () => {
      disposed = true;
      openRef.current = () => {};
      if (timer) clearTimeout(timer);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      editor.off('transaction', onTransaction);
      stopCommands(); stopClosed(); stopStore(); stopLanguage();
      void closeNavigatorPanels(session).catch(error => console.warn('[panels] cleanup unavailable:', error));
    };
  }, [editor, documentIdentity]);
  const open = useCallback(() => openRef.current(), []);
  const available = !!editor && !editor.isDestroyed && canPopOutNavigator();
  return useMemo(() => ({ detached, available, open }), [detached, available, open]);
}
