import React, { useRef, useCallback, useEffect } from 'react';
import DOMPurify from 'dompurify';

interface MiniRichTextProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Minimum height in px */
  minHeight?: number;
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'ul', 'li', 'br', 'div', 'span', 'p'],
  ALLOWED_ATTR: ['style'],
};

/**
 * Lightweight rich text editor for character profile fields.
 * Uses contentEditable with execCommand for B / I / U / bullet list.
 * Stores content as HTML string.
 */
const MiniRichText: React.FC<MiniRichTextProps> = ({
  value,
  onChange,
  placeholder = '',
  minHeight = 60,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Sync external value → DOM (only when value changes externally)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (el && el.innerHTML !== value) {
      el.innerHTML = DOMPurify.sanitize(value, PURIFY_CONFIG);
    }
  }, [value]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    isInternalChange.current = true;
    onChange(el.innerHTML);
  }, [onChange]);

  const exec = useCallback((cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    // Trigger update
    handleInput();
  }, [handleInput]);

  const isActive = useCallback((cmd: string): boolean => {
    return document.queryCommandState(cmd);
  }, []);

  // Prevent losing focus on toolbar click
  const handleToolbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="mini-rt-wrapper">
      <div className="mini-rt-toolbar" onMouseDown={handleToolbarMouseDown}>
        <button
          className={`mini-rt-btn${isActive('bold') ? ' active' : ''}`}
          onClick={() => exec('bold')}
          title="Bold"
          type="button"
        >
          <strong>B</strong>
        </button>
        <button
          className={`mini-rt-btn${isActive('italic') ? ' active' : ''}`}
          onClick={() => exec('italic')}
          title="Italic"
          type="button"
        >
          <em>I</em>
        </button>
        <button
          className={`mini-rt-btn${isActive('underline') ? ' active' : ''}`}
          onClick={() => exec('underline')}
          title="Underline"
          type="button"
        >
          <u>U</u>
        </button>
        <span className="mini-rt-sep" />
        <button
          className={`mini-rt-btn${isActive('insertUnorderedList') ? ' active' : ''}`}
          onClick={() => exec('insertUnorderedList')}
          title="Bullet list"
          type="button"
        >
          &#8226;
        </button>
      </div>
      <div
        ref={editorRef}
        className="mini-rt-editor"
        contentEditable
        data-placeholder={placeholder}
        onInput={handleInput}
        onBlur={handleInput}
        style={{ minHeight }}
      />
    </div>
  );
};

export default MiniRichText;
