import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The scene colours, in rainbow order, then black, white and none.
 *
 * One list for the Synopsis dialog and the Navigator's inline strip, so a
 * colour picked in either is a colour the other shows as chosen.
 */
const SCENE_COLORS: ReadonlyArray<{ value: string; name: SceneColorName }> = [
  { value: '#8b5cf6', name: 'violet' },
  { value: '#4f46e5', name: 'indigo' },
  { value: '#2563eb', name: 'blue' },
  { value: '#059669', name: 'green' },
  { value: '#eab308', name: 'yellow' },
  { value: '#f97316', name: 'orange' },
  { value: '#ef4444', name: 'red' },
  { value: '#000000', name: 'black' },
  { value: '#ffffff', name: 'white' },
  { value: '', name: 'none' },
];

type SceneColorName = 'violet' | 'indigo' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'black' | 'white' | 'none';

interface SceneColorSwatchesProps {
  value: string;
  /** `source` says whether a listed swatch or the custom picker chose it. */
  onChange: (color: string, source: 'preset' | 'custom') => void;
  /** Offer the system colour picker as well. */
  allowCustom?: boolean;
  /** Smaller swatches, for the Navigator row. */
  compact?: boolean;
  className?: string;
  /** Focus the chosen swatch on mount, so the strip can be used from the keyboard. */
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/** Normalised for comparison: stored colours come from many places and cases. */
const same = (a: string, b: string) => (a || '').toLowerCase() === (b || '').toLowerCase();

const SceneColorSwatches: React.FC<SceneColorSwatchesProps> = ({
  value, onChange, allowCustom = true, compact = false, className = '', autoFocus = false, onKeyDown,
}) => {
  const { t } = useTranslation(['story', 'common']);
  const isCustom = !!value && !SCENE_COLORS.some((c) => same(c.value, value));
  return (
    <div
      className={`synopsis-color-swatches${compact ? ' synopsis-color-swatches--compact' : ''} ${className}`.trim()}
      role="radiogroup"
      aria-label={t('synopsis.sceneColor')}
      onKeyDown={(e) => {
        // A radio group moves with the arrow keys.
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (at >= 0) {
            e.preventDefault();
            const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
            const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
            const step = (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && rtl ? (forward ? -1 : 1) : (forward ? 1 : -1);
            buttons[(at + step + buttons.length) % buttons.length].focus();
          }
        }
        onKeyDown?.(e);
      }}
    >
      {SCENE_COLORS.map((c) => {
        const selected = same(c.value, value);
        const name = t(`synopsis.colors.${c.name}`);
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            className={`synopsis-color-swatch${selected ? ' active' : ''}${c.value ? '' : ' synopsis-color-swatch--none'}`}
            style={c.value ? { background: c.value } : undefined}
            onClick={(e) => { e.stopPropagation(); onChange(c.value, 'preset'); }}
            title={name}
            tabIndex={selected || (!value && !c.value) || (isCustom && c.name === 'violet') ? 0 : -1}
            autoFocus={autoFocus && (selected || (isCustom && c.name === 'violet'))}
          />
        );
      })}
      {allowCustom && (
        <label
          className={`synopsis-color-custom${isCustom ? ' active' : ''}`}
          title={t('synopsis.customColor')}
          style={isCustom ? { background: value } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="color"
            aria-label={t('synopsis.customColor')}
            value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
            onChange={(e) => onChange(e.target.value, 'custom')}
          />
          <span aria-hidden="true">+</span>
        </label>
      )}
    </div>
  );
};

export default SceneColorSwatches;
