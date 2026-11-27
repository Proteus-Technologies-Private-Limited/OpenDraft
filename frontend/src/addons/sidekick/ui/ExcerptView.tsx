/**
 * An excerpt drawn as the script draws it: built by the script's own schema
 * (so the element classes and marks are the editor's), shown at a reduced
 * scale through core's own `--script-scale` / `--indent-scale` variables.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { PLUGIN_ID, type Excerpt } from '../model';
import { renderExcerpt } from '../script';

/** Beyond this the excerpt is folded until the writer asks for all of it. */
const FOLD_CHARS = 280;

export function ExcerptView({ editor, excerpt }: { editor: Editor | null; excerpt: Excerpt }) {
  const { t } = useTranslation(PLUGIN_ID);
  const box = useRef<HTMLDivElement>(null);
  const long = excerpt.text.length > FOLD_CHARS;
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fragment = editor && !editor.isDestroyed ? renderExcerpt(editor.schema, excerpt) : null;
    if (fragment) {
      el.replaceChildren(fragment);
      el.classList.remove('sk-excerpt--plain');
    } else {
      el.textContent = excerpt.text;
      el.classList.add('sk-excerpt--plain');
    }
  }, [editor, excerpt]);

  return (
    <div className="sk-excerpt-wrap">
      <div ref={box} className={`sk-excerpt${long && !open ? ' sk-excerpt--folded' : ''}`} />
      {long && (
        <button type="button" className="sk-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('task.less') : t('task.more')}
        </button>
      )}
    </div>
  );
}
