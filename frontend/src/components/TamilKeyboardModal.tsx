import React, { useState, useEffect, useRef } from 'react';

export interface TamilKeyboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

// Scrite-referenced transliteration mappings (PhTranslator + Sanscript conventions)
export const TAMIL_VOWELS = [
  { latin: 'a', independent: 'அ', sign: '', name: 'a' },
  { latin: 'aa / A', independent: 'ஆ', sign: 'ா', name: 'aa' },
  { latin: 'i', independent: 'இ', sign: 'ி', name: 'i' },
  { latin: 'ee / I', independent: 'ஈ', sign: 'ீ', name: 'ee' },
  { latin: 'u', independent: 'உ', sign: 'ு', name: 'u' },
  { latin: 'oo / U', independent: 'ஊ', sign: 'ூ', name: 'oo' },
  { latin: 'e', independent: 'எ', sign: 'ெ', name: 'e' },
  { latin: 'E / ee', independent: 'ஏ', sign: 'ே', name: 'E' },
  { latin: 'ai', independent: 'ஐ', sign: 'ை', name: 'ai' },
  { latin: 'o', independent: 'ஒ', sign: 'ொ', name: 'o' },
  { latin: 'O / oo', independent: 'ஓ', sign: 'ோ', name: 'O' },
  { latin: 'au', independent: 'ஔ', sign: 'ௌ', name: 'au' },
];

export const TAMIL_SPECIAL = [
  { latin: 'H / :', char: 'ஃ', name: 'Ayutha Ezhuthu / Visarga' },
  { latin: 'OM', char: 'ௐ', name: 'Om symbol' },
  { latin: 'M', char: 'ஂ', name: 'Anusvara' },
];

export const TAMIL_CONSONANTS = [
  { latin: 'k / g', char: 'க', mei: 'க்', name: 'ka' },
  { latin: 'ng', char: 'ங', mei: 'ங்', name: 'nga' },
  { latin: 'ch / s', char: 'ச', mei: 'ச்', name: 'cha / sa' },
  { latin: 'j', char: 'ஜ', mei: 'ஜ்', name: 'ja (Grantha)' },
  { latin: 'nj / ny', char: 'ஞ', mei: 'ஞ்', name: 'nya' },
  { latin: 'T / t', char: 'ட', mei: 'ட்', name: 'Ta (Retroflex)' },
  { latin: 'N / nn', char: 'ண', mei: 'ண்', name: 'Na (Retroflex)' },
  { latin: 'th / d', char: 'த', mei: 'த்', name: 'tha (Dental)' },
  { latin: 'n', char: 'ந', mei: 'ந்', name: 'na (Dental)' },
  { latin: 'n2 / n', char: 'ன', mei: 'ன்', name: 'na (Alveolar)' },
  { latin: 'p / b', char: 'ப', mei: 'ப்', name: 'pa' },
  { latin: 'm', char: 'ம', mei: 'ம்', name: 'ma' },
  { latin: 'y', char: 'ய', mei: 'ய்', name: 'ya' },
  { latin: 'r', char: 'ர', mei: 'ர்', name: 'ra' },
  { latin: 'R / tr', char: 'ற', mei: 'ற்', name: 'Ra' },
  { latin: 'l', char: 'ல', mei: 'ல்', name: 'la' },
  { latin: 'L / ll', char: 'ள', mei: 'ள்', name: 'La' },
  { latin: 'zh / zL', char: 'ழ', mei: 'ழ்', name: 'zha' },
  { latin: 'v / w', char: 'வ', mei: 'வ்', name: 'va' },
  { latin: 'sh', char: 'ஶ', mei: 'ஶ்', name: 'sha (Grantha)' },
  { latin: 'Sh', char: 'ஷ', mei: 'ஷ்', name: 'Sha (Grantha)' },
  { latin: 's / S', char: 'ஸ', mei: 'ஸ்', name: 'sa (Grantha)' },
  { latin: 'h', char: 'ஹ', mei: 'ஹ்', name: 'ha (Grantha)' },
  { latin: 'ksh', char: 'க்ஷ', mei: 'க்ஷ்', name: 'ksha' },
];

export const TAMIL_DIGITS = [
  { latin: '0 / z0', char: '௦' },
  { latin: '1 / z1', char: '௧' },
  { latin: '2 / z2', char: '௨' },
  { latin: '3 / z3', char: '௩' },
  { latin: '4 / z4', char: '௪' },
  { latin: '5 / z5', char: '௫' },
  { latin: '6 / z6', char: '௬' },
  { latin: '7 / z7', char: '௭' },
  { latin: '8 / z8', char: '௮' },
  { latin: '9 / z9', char: '௯' },
  { latin: '10 / z10', char: '௰' },
  { latin: '100 / z100', char: '௱' },
  { latin: '1000 / z1000', char: '௲' },
];

export const TAMIL_EXAMPLES = [
  { eng: 'vanakkam', ta: 'வணக்கம்' },
  { eng: 'tamil / thamizh', ta: 'தமிழ்' },
  { eng: 'kaatchi', ta: 'காட்சி' },
  { eng: 'nandri', ta: 'நன்றி' },
  { eng: 'ammaa', ta: 'அம்மா' },
  { eng: 'cinema', ta: 'சினிமா' },
  { eng: 'eppadi', ta: 'எப்படி' },
  { eng: 'irukkeenga', ta: 'இருக்கீங்க' },
];

export const TamilKeyboardModal: React.FC<TamilKeyboardModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'vowels' | 'consonants' | 'digits' | 'examples'>('all');
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleClickOutside, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: '0 24px 34px 24px',
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-label="Tamil Transliteration Keyboard"
        style={{
          width: '640px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '80vh',
          background: 'var(--fd-dialog-bg, #1e1e24)',
          color: 'var(--fd-text, #e2e8f0)',
          borderRadius: '8px',
          border: '1px solid var(--fd-border, #333a4d)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'tamilModalFadeIn 0.15s ease-out',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid var(--fd-border, #333a4d)',
            background: 'var(--fd-menubar-bg, #16161a)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>⌨️</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                Tamil Phonetic Keyboard (தமிழ் விசைப்பலகை)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--fd-text-muted, #94a3b8)' }}>
                English keystrokes reference from Scrite / Sanscript
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fd-text-muted, #94a3b8)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &times;
          </button>
        </div>

        {/* Tab Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '8px 16px',
            background: 'rgba(0, 0, 0, 0.15)',
            borderBottom: '1px solid var(--fd-border, #333a4d)',
            fontSize: '11px',
          }}
        >
          {(['all', 'vowels', 'consonants', 'digits', 'examples'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? '#2563eb' : 'transparent',
                color: activeTab === tab ? '#ffffff' : 'var(--fd-text-muted, #94a3b8)',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 10px',
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
                transition: 'all 0.12s ease',
              }}
            >
              {tab === 'all' ? 'All Mappings' : tab === 'vowels' ? 'Vowels (உயிர்)' : tab === 'consonants' ? 'Consonants (மெய்)' : tab === 'digits' ? 'Digits (எண்கள்)' : 'Common Words'}
            </button>
          ))}
        </div>

        {/* Modal Scrollable Content */}
        <div
          style={{
            padding: '14px 16px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            fontSize: '12px',
          }}
        >
          {/* Vowels Section */}
          {(activeTab === 'all' || activeTab === 'vowels') && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', padding: '10px', border: '1px solid var(--fd-border, #333a4d)' }}>
              <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Vowels & Signs (உயிர் எழுத்துக்கள் & குறியீடுகள்)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '6px',
                }}
              >
                {TAMIL_VOWELS.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>{v.latin}</span>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#ffffff' }}>
                      {v.independent} {v.sign ? <span style={{ opacity: 0.65, fontSize: '12px' }}>({v.sign})</span> : ''}
                    </span>
                  </div>
                ))}
              </div>

              {/* Special Characters */}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--fd-border, #333a4d)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {TAMIL_SPECIAL.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>{s.latin}</span>
                    <span style={{ fontSize: '13px', color: '#ffffff' }}>{s.char}</span>
                    <span style={{ fontSize: '10px', color: 'var(--fd-text-muted, #94a3b8)' }}>({s.name})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consonants Section */}
          {(activeTab === 'all' || activeTab === 'consonants') && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', padding: '10px', border: '1px solid var(--fd-border, #333a4d)' }}>
              <div style={{ fontWeight: 600, color: '#4ade80', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Consonants (மெய் எழுத்துக்கள்)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '6px',
                }}
              >
                {TAMIL_CONSONANTS.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>{c.latin}</span>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#ffffff' }}>
                      {c.char} <span style={{ opacity: 0.65, fontSize: '11px' }}>({c.mei})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Digits Section */}
          {(activeTab === 'all' || activeTab === 'digits') && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', padding: '10px', border: '1px solid var(--fd-border, #333a4d)' }}>
              <div style={{ fontWeight: 600, color: '#c084fc', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Tamil Digits (தமிழ் எண்கள்)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                  gap: '6px',
                }}
              >
                {TAMIL_DIGITS.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: '11px' }}>{d.latin}</span>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#ffffff' }}>{d.char}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common Word Examples Section */}
          {(activeTab === 'all' || activeTab === 'examples') && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', padding: '10px', border: '1px solid var(--fd-border, #333a4d)' }}>
              <div style={{ fontWeight: 600, color: '#f472b6', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Common Words & Typing Tips (எடுத்துக்காட்டுகள்)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '6px',
                }}
              >
                {TAMIL_EXAMPLES.map((ex, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: '#93c5fd', fontSize: '11px' }}>{ex.eng}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80' }}>{ex.ta}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--fd-text-muted, #94a3b8)', lineHeight: 1.5 }}>
                💡 <b>Tip:</b> Type the English phonetic word and press <kbd style={{ background: '#334155', padding: '1px 5px', borderRadius: '3px', color: '#fff' }}>Space</kbd> or punctuation to immediately convert it to Tamil. You can toggle Tamil typing on or off anytime using <kbd style={{ background: '#334155', padding: '1px 5px', borderRadius: '3px', color: '#fff' }}>Ctrl+M</kbd> (or <kbd style={{ background: '#334155', padding: '1px 5px', borderRadius: '3px', color: '#fff' }}>Cmd+M</kbd>).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TamilKeyboardModal;
