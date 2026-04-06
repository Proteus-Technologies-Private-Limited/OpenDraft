import React, { useEffect, useRef, useState } from 'react';

interface ColorPickerProps {
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

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [customColor, setCustomColor] = useState(value || '#000000');

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
    <div className="color-picker-popup" ref={ref}>
      <div className="color-picker-swatches">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`color-picker-swatch${value === color ? ' active' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            title={color}
          />
        ))}
      </div>
      <div className="color-picker-custom">
        <input
          type="color"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="color-picker-input"
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="color-picker-hex"
          placeholder="#000000"
          maxLength={7}
        />
        <button
          className="color-picker-apply"
          onClick={() => onChange(customColor)}
        >
          Apply
        </button>
      </div>
      <button
        className="color-picker-reset"
        onClick={() => onChange(null)}
      >
        Reset to Default
      </button>
    </div>
  );
};

export default ColorPicker;
