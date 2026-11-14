// Helpers prefixed to every snippet sim.py evaluates. Nothing here awaits:
// Runtime.evaluate returns before a promise settles, so each call is one step.
const od = {
  editor() {
    const el = document.querySelector('.ProseMirror');
    if (!el || !el.editor) throw new Error('editor not mounted');
    return el.editor;
  },
  visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },
  text(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); },
  // Click the first visible element matching `selector` whose text starts with `label`.
  click(selector, label) {
    const all = [...document.querySelectorAll(selector)].filter(od.visible);
    const hit = all.find((e) => od.text(e) === label) || all.find((e) => od.text(e).startsWith(label));
    if (!hit) return 'NOT FOUND: ' + label + ' among ' + JSON.stringify(all.map(od.text).slice(0, 40));
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return 'clicked ' + od.text(hit).slice(0, 40);
  },
  // Put the caret inside the first block containing `snippet` and bring it on screen.
  caretAt(snippet, align = 'center') {
    const editor = od.editor();
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isTextblock && node.textContent.includes(snippet)) found = pos + 1;
      return found < 0;
    });
    if (found < 0) return 'NOT FOUND: ' + snippet;
    editor.commands.setTextSelection(found);
    const dom = editor.view.domAtPos(found).node;
    (dom.nodeType === 1 ? dom : dom.parentElement).scrollIntoView({ block: align });
    return 'caret at ' + found;
  },
  // Type into a React-controlled input: the native setter plus an input event.
  fill(placeholder, value) {
    const input = [...document.querySelectorAll('input')].filter(od.visible).find((e) => e.placeholder === placeholder);
    if (!input) return 'NOT FOUND: input ' + placeholder;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled ' + input.value;
  },
  // Scroll the script smoothly: starts after `delay` ms and takes `duration` ms.
  glide(distance, delay = 500, duration = 3000) {
    let el = document.querySelector('.ProseMirror');
    while (el && !(el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement;
    if (!el) return 'NO SCROLLER';
    const from = el.scrollTop, start = performance.now() + delay;
    const step = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      el.scrollTop = from + distance * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return 'gliding ' + String(el.className).slice(0, 40);
  },
  dump(selector, limit = 40) {
    return JSON.stringify([...document.querySelectorAll(selector)].filter(od.visible).slice(0, limit)
      .map((e) => e.tagName + '.' + String(e.className).slice(0, 50) + ': ' + od.text(e).slice(0, 50)));
  },
};
