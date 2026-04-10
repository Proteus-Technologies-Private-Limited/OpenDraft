import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { isTauri } from '../services/platform';

const DISMISSED_KEY = 'opendraft:demo-banner-dismissed';

const DemoBanner: React.FC = () => {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 600);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      alignItems: isMobile ? 'flex-start' : 'center',
      justifyContent: 'center',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: isMobile ? '24px 0' : 0,
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '2px solid #e67e22',
        borderRadius: isMobile ? 10 : 14,
        padding: isMobile ? '28px 20px 24px' : '44px 48px 40px',
        maxWidth: 620,
        width: isMobile ? 'calc(100% - 32px)' : '90%',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: isMobile ? 36 : 52,
          marginBottom: isMobile ? 10 : 16,
        }}>&#9888;</div>
        <h2 style={{
          margin: isMobile ? '0 0 16px' : '0 0 24px',
          fontSize: isMobile ? 22 : 28,
          fontWeight: 700,
          color: '#e67e22',
        }}>Demo Server</h2>
        <div style={{
          textAlign: 'left',
          marginBottom: isMobile ? 20 : 32,
        }}>
          {lines.map((line, i) => (
            <p key={i} style={{
              fontSize: isMobile ? 14 : 18,
              lineHeight: 1.6,
              margin: isMobile ? '0 0 10px' : '0 0 16px',
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
            padding: isMobile ? '12px 32px' : '14px 44px',
            fontSize: isMobile ? 16 : 18,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: 0.3,
            width: isMobile ? '100%' : 'auto',
          }}
        >
          I Understand
        </button>
      </div>
    </div>
  );
};

export default DemoBanner;
