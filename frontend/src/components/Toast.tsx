import React, { useEffect, useState, useCallback } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  type: 'error' | 'success' | 'info';
}

let nextId = 0;
const listeners: Array<(msg: ToastMessage) => void> = [];

/** Call from anywhere to show a toast. */
export function showToast(text: string, type: ToastMessage['type'] = 'info') {
  const msg: ToastMessage = { id: ++nextId, text, type };
  listeners.forEach((fn) => fn(msg));
}

const Toast: React.FC = () => {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addMessage = useCallback((msg: ToastMessage) => {
    setMessages((prev) => [...prev, msg]);
    const duration = msg.type === 'error' ? 8000 : 4000;
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    }, duration);
  }, []);

  useEffect(() => {
    listeners.push(addMessage);
    return () => {
      const idx = listeners.indexOf(addMessage);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, [addMessage]);

  if (messages.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 100000,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {messages.map((m) => (
        <div
          key={m.id}
          onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            maxWidth: 420,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            background: m.type === 'error' ? '#c0392b' : m.type === 'success' ? '#27ae60' : '#2c3e50',
          }}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
};

export default Toast;
