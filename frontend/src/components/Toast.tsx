import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Routine feedback expires after four seconds of unpaused viewing. */
const ToastItem: React.FC<{ message: ToastMessage; dismiss: (id: number) => void }> = ({ message, dismiss }) => {
  const { t } = useTranslation('common');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(4000);
  useEffect(() => {
    if (message.type === 'error' || hovered || focused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss(message.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [message, hovered, focused, dismiss]);
  return <div className={`toast-message toast-message--${message.type}`} data-toast-id={message.id}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onClick={() => dismiss(message.id)}>
    <span>{message.text}</span>
    <button type="button" aria-label={`${t('dismiss')}: ${message.text}`}>×</button>
  </div>;
};

const Toast: React.FC = () => {
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

  const dismiss = useCallback((id: number) => {
    const current = host?.querySelector<HTMLElement>(`[data-toast-id="${id}"] button`);
    if (current && document.activeElement === current) {
      const buttons = Array.from(host!.querySelectorAll<HTMLElement>('.toast-stack button'));
      const next = buttons[buttons.indexOf(current) + 1] ?? buttons[buttons.indexOf(current) - 1];
      const previous = returnFocus.current;
      const container = modalPortalContainer();
      const fallback = container === document.body
        ? document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]')
        : focusableElements(container).find(element => !host?.contains(element));
      (next ?? (previous?.isConnected && !previous.closest('[inert], [hidden]') ? previous : fallback))?.focus();
    }
    setMessages(previous => previous.filter(item => item.id !== id));
  }, [host]);

  // Live regions remain mounted even after a visual notification expires.
  // Arrival and automatic dismissal never move focus.
  const content = <>
    <div className="a11y-only" role="status" aria-atomic="true"><span key={announcement.polite?.id}>{announcement.polite?.text}</span></div>
    <div className="a11y-only" role="alert" aria-atomic="true"><span key={announcement.assertive?.id}>{announcement.assertive?.text}</span></div>
    <div className="toast-stack" onFocusCapture={event => {
      if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) returnFocus.current = event.relatedTarget;
    }}>
      {messages.map(message => <ToastItem key={message.id} message={message} dismiss={dismiss} />)}
    </div>
  </>;
  return host ? createPortal(content, host) : content;
};

export default Toast;
