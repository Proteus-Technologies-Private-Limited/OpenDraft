import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { isTauri } from '../services/platform';

const DISMISSED_KEY = 'opendraft:demo-banner-dismissed';

const DemoBanner: React.FC = () => {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only applies to browser — never show on desktop or mobile apps
    if (isTauri()) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    api.getDemoInfo()
      .then((info) => {
        if (info.demo && info.message) {
          setMessage(info.message);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!visible || !message) return null;

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(DISMISSED_KEY, '1');
  };

  const lines = message.split('. ').filter(Boolean).map(
    (s) => s.endsWith('.') ? s : s + '.'
  );

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200000,
      background: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '2px solid #e67e22',
        borderRadius: 14,
        padding: '44px 48px 40px',
        maxWidth: 620,
        width: '90%',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          fontSize: 52,
          marginBottom: 16,
        }}>&#9888;</div>
        <h2 style={{
          margin: '0 0 24px',
          fontSize: 28,
          fontWeight: 700,
          color: '#e67e22',
        }}>Demo Server</h2>
        <div style={{
          textAlign: 'left',
          marginBottom: 32,
        }}>
          {lines.map((line, i) => (
            <p key={i} style={{
              fontSize: 18,
              lineHeight: 1.6,
              margin: '0 0 16px',
              color: '#fff',
            }}>{line}</p>
          ))}
        </div>
        <button
          onClick={dismiss}
          style={{
            background: '#e67e22',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '14px 44px',
            fontSize: 18,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: 0.3,
          }}
        >
          I Understand
        </button>
      </div>
    </div>
  );
};

export default DemoBanner;
