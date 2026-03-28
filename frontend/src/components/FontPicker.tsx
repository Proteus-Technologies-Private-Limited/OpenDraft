import React, { useMemo } from 'react';
import { FONT_REGISTRY, FONT_CATEGORIES, loadFont, getFontsByCategory } from '../utils/fonts';
import type { FontEntry } from '../utils/fonts';

interface FontPickerProps {
  value: string;
  onChange: (fontName: string) => void;
  extraFonts?: string[];
}

const FontPicker: React.FC<FontPickerProps> = ({ value, onChange, extraFonts = [] }) => {
  const fontsByCategory = useMemo(() => getFontsByCategory(), []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const fontName = e.target.value;
    const entry = FONT_REGISTRY.find(f => f.name === fontName);
    if (entry) {
      loadFont(entry);
    }
    onChange(fontName);
  };

  return (
    <select
      className="font-selector"
      value={value}
      onChange={handleChange}
      title="Font Family"
    >
      {/* Extra fonts from document that aren't in the registry */}
      {extraFonts.length > 0 && (
        <optgroup label="Document Fonts">
          {extraFonts.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </optgroup>
      )}
      {FONT_CATEGORIES.map(category => {
        const fonts = fontsByCategory[category];
        if (!fonts || fonts.length === 0) return null;
        return (
          <optgroup key={category} label={category}>
            {fonts.map((font: FontEntry) => (
              <option key={font.name} value={font.name}>
                {font.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
};

export default FontPicker;
