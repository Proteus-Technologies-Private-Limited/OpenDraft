import React from 'react';
import { Editor } from '@tiptap/react';

interface LanguageOption {
  code: string | null;
  label: string;
  dir: 'ltr' | 'rtl';
}

const LANGUAGES: LanguageOption[] = [
  { code: null, label: 'Default', dir: 'ltr' },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'hi', label: 'Hindi (\u0939\u093F\u0928\u094D\u0926\u0940)', dir: 'ltr' },
  { code: 'bn', label: 'Bengali (\u09AC\u09BE\u0982\u09B2\u09BE)', dir: 'ltr' },
  { code: 'ta', label: 'Tamil (\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD)', dir: 'ltr' },
  { code: 'te', label: 'Telugu (\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41)', dir: 'ltr' },
  { code: 'kn', label: 'Kannada (\u0C95\u0CA8\u0CCD\u0CA8\u0CA1)', dir: 'ltr' },
  { code: 'ml', label: 'Malayalam (\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02)', dir: 'ltr' },
  { code: 'gu', label: 'Gujarati (\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0)', dir: 'ltr' },
  { code: 'pa', label: 'Punjabi (\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40)', dir: 'ltr' },
  { code: 'mr', label: 'Marathi (\u092E\u0930\u093E\u0920\u0940)', dir: 'ltr' },
  { code: 'ar', label: 'Arabic (\u0627\u0644\u0639\u0631\u0628\u064A\u0629)', dir: 'rtl' },
  { code: 'he', label: 'Hebrew (\u05E2\u05D1\u05E8\u05D9\u05EA)', dir: 'rtl' },
  { code: 'ja', label: 'Japanese (\u65E5\u672C\u8A9E)', dir: 'ltr' },
  { code: 'zh', label: 'Chinese (\u4E2D\u6587)', dir: 'ltr' },
  { code: 'ko', label: 'Korean (\uD55C\uAD6D\uC5B4)', dir: 'ltr' },
  { code: 'th', label: 'Thai (\u0E44\u0E17\u0E22)', dir: 'ltr' },
  { code: 'fr', label: 'French', dir: 'ltr' },
  { code: 'es', label: 'Spanish', dir: 'ltr' },
  { code: 'de', label: 'German', dir: 'ltr' },
  { code: 'ru', label: 'Russian', dir: 'ltr' },
];

interface LanguageSelectorProps {
  editor: Editor | null;
  activeElement: string;
}

const DIALOGUE_ELEMENTS = ['dialogue', 'parenthetical', 'character'];

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ editor, activeElement }) => {
  // Only show for dialogue-related elements
  if (!DIALOGUE_ELEMENTS.includes(activeElement)) return null;
  if (!editor) return null;

  // Read the current lang attribute from the active node
  const currentAttrs = editor.getAttributes(activeElement);
  const currentLang = currentAttrs?.lang || '';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedCode = e.target.value || null;
    const langOption = LANGUAGES.find(l => (l.code || '') === (selectedCode || ''));
    const dir = langOption?.dir || 'ltr';

    editor
      .chain()
      .focus()
      .updateAttributes(activeElement, {
        lang: selectedCode,
        dir: selectedCode ? dir : null,
      })
      .run();
  };

  return (
    <select
      className="language-selector"
      value={currentLang || ''}
      onChange={handleChange}
      title="Dialogue Language"
    >
      {LANGUAGES.map(lang => (
        <option key={lang.code || 'default'} value={lang.code || ''}>
          {lang.label}
        </option>
      ))}
    </select>
  );
};

export default LanguageSelector;
