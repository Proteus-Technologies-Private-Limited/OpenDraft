import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { focusableElements, modalPortalContainer, subscribeModalLayers } from '../utils/modalAccessibility';
import { movePanelHost } from '../utils/movePanelHost';

interface ToastMessage {
  id: number;
  text: string;
  type: 'error' | 'success' | 'info';
}

let nextId = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

/** Explicit operation feedback only; editor transactions must not call this. */
// eslint-disable-next-line react-refresh/only-export-components -- Preserve the existing public toast API.
export function showToast(text: string, type: ToastMessage['type'] = 'info') {
  const msg: ToastMessage = { id: ++nextId, text, type };
  listeners.forEach(fn => fn(msg));
}

const Toast: React.FC = () => {
  const { t } = useTranslation('common');
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const [announcement, setAnnouncement] = useState<{ polite: ToastMessage | null; assertive: ToastMessage | null }>({ polite: null, assertive: null });
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    const place = () => movePanelHost(host, modalPortalContainer());
    place();
    const unsubscribe = subscribeModalLayers(place);
    return () => { unsubscribe(); host.remove(); };
  }, [host]);
  useEffect(() => {
    const add = (message: ToastMessage) => {
      setMessages(previous => [...previous, message]);
      setAnnouncement(previous => ({ ...previous, [message.type === 'error' ? 'assertive' : 'polite']: message }));
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  // Keep live regions mounted before their text changes. Messages stay available
  // until dismissed: no reading deadline and no focus movement on arrival.
  const content = <>
    <div className="a11y-only" role="status" aria-atomic="true"><span key={announcement.polite?.id}>{announcement.polite?.text}</span></div>
    <div className="a11y-only" role="alert" aria-atomic="true"><span key={announcement.assertive?.id}>{announcement.assertive?.text}</span></div>
    <div className="toast-stack" onFocusCapture={event => {
      if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) returnFocus.current = event.relatedTarget;
    }}>
      {messages.map(message => (
        <div key={message.id} className={`toast-message toast-message--${message.type}`}>
          <span>{message.text}</span>
          <button type="button" aria-label={`${t('dismiss')}: ${message.text}`}
            onClick={event => {
              const current = event.currentTarget;
              const buttons = Array.from(current.closest('.toast-stack')!.querySelectorAll('button'));
              const next = buttons[buttons.indexOf(current) + 1] ?? buttons[buttons.indexOf(current) - 1];
              if (document.activeElement === current) {
                const previous = returnFocus.current;
                const container = modalPortalContainer();
                const fallback = container === document.body
                  ? document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]')
                  : focusableElements(container).find(element => !host?.contains(element));
                (next ?? (previous?.isConnected && !previous.closest('[inert], [hidden]') ? previous : fallback))?.focus();
              }
              setMessages(previous => previous.filter(item => item.id !== message.id));
            }}>×</button>
        </div>
      ))}
    </div>
  </>;
  return host ? createPortal(content, host) : content;
};

export default Toast;
