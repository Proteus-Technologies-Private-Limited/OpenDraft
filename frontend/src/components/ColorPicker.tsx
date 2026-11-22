import { ChoiceLineBack, ChoiceLineClose } from './toolbar/ChoiceLineControls';
import React, { useEffect, useLayoutEffect, useCallback, useRef, useState } from 'react';
import { toolbarChoiceLine, useChoiceLineLifecycle, useChoiceLinePosition, moveChoiceFocus } from './toolbar/choiceLine';
import { useTranslation } from 'react-i18next';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string | null) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  '#ff0000', '#ff6600', '#ffcc00', '#33cc33', '#0066ff', '#9933ff',
  '#cc0000', '#cc6600', '#999900', '#006600', '#003399', '#660099',
  '#ff6666', '#ffcc66', '#ffff66', '#66ff66', '#66ccff', '#cc66ff',
];

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange, onClose }) => {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  const [customColor, setCustomColor] = useState(value || '#000000');
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? document.activeElement as HTMLElement : null);
  const [line, setLine] = useState<ReturnType<typeof toolbarChoiceLine>>(null);
  useLayoutEffect(() => { if (ref.current) setLine(toolbarChoiceLine(ref.current)); }, []);
  useChoiceLineLifecycle(!!line, opener, ref, onClose);
  useChoiceLinePosition(!!line, ref, useCallback(() => { if (ref.current) setLine(toolbarChoiceLine(ref.current)); }, []));
  const close = () => { onClose(); opener.current?.focus(); };
  const choose = (color: string | null) => { onChange(color); };
  const validColor = /^#[0-9a-f]{6}$/i.test(customColor);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div className={`color-picker-popup${line ? ' toolbar-choice-line color-picker-popup--line' : ''}`} ref={ref} role="dialog" aria-label={label}
      style={line ? { position: 'fixed', left: line.left, top: line.top, width: line.width, height: line.height } : undefined}
      onKeyDown={event => {
        if (line) moveChoiceFocus(event);
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault(); event.stopPropagation();
        opener.current?.focus();
        onClose();
      }}>
      {line && <ChoiceLineBack label={label} onClose={close} />}
      <div className={line ? 'toolbar-choice-options' : undefined}>
      <div className="color-picker-swatches">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`color-picker-swatch${value === color ? ' active' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => choose(color)}
            title={color}
            aria-pressed={value.toLowerCase() === color}
          />
        ))}
      </div>
      <div className="color-picker-custom">
        <input
          type="color"
          aria-label={label}
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="color-picker-input"
        />
        <input
          type="text"
          aria-label={`${label} (#RRGGBB)`}
          aria-invalid={!validColor}
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="color-picker-hex"
          placeholder="#000000"
          maxLength={7}
        />
        <button
          className="color-picker-apply"
          disabled={!validColor}
          onClick={() => choose(customColor)}
        >
          {t('apply')}
        </button>
      </div>
      <button
        className="color-picker-reset"
        onClick={() => choose(null)}
      >
        {t('resetToDefault', { ns: 'toolbar' })}
      </button>
      </div>
      {line && <ChoiceLineClose onClose={close} />}
    </div>
  );
};

export default ColorPicker;
