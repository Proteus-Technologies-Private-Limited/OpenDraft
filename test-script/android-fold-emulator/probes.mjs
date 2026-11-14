// Functions serialized into the real app through CDP. No native-signal mocks.
export function initialize(label) {
  if (window.__foldTest) return true;
  const blank = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Blank Document'));
  if (blank) { blank.click(); return false; }
  let element = document.querySelector('.ProseMirror');
  let editor;
  while (element && !editor) {
    const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
    let fiber = key && element[key];
    while (fiber) {
      if (fiber.memoizedProps?.editor?.commands) { editor = fiber.memoizedProps.editor; break; }
      fiber = fiber.return;
    }
    element = element.parentElement;
  }
  if (!editor || !window.OpenDraftAndroidFold?.snapshot) return false;
  const native = JSON.parse(window.OpenDraftAndroidFold.snapshot());
  if (native.status !== 'available' || !native.active || native.webView?.width <= 0) return false;
  editor.commands.setContent({ type: 'doc', content: Array.from({ length: 60 }, (_, i) => ({
    type: 'action', content: [{ type: 'text', text: `Synthetic ${label} emulator paragraph ${i + 1}. The draft stays in this test window.` }],
  })) });
  editor.commands.setTextSelection({ from: 15, to: 24 });
  editor.view.focus();
  window.__foldTest = { editor, doc: editor.state.doc, from: 15, to: 24,
    element: document.querySelector('.ProseMirror'), token: crypto.randomUUID(),
    expectedPad: `Synthetic ${label} writing-pad draft`, area: null, padFrom: 0, padTo: 9 };
  window.dispatchEvent(new CustomEvent('opendraft:handwriting'));
  return true;
}

export function seedPad() {
  const test = window.__foldTest;
  const area = document.querySelector('.scribble-area');
  if (!test || !area) return false;
  if (!test.area) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, test.expectedPad);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.focus(); area.setSelectionRange(0, 9);
    test.area = area;
  }
  return area.value === test.expectedPad;
}

export function snapshot() {
  const test = window.__foldTest;
  const area = document.querySelector('.scribble-area');
  const native = window.OpenDraftAndroidFold ? JSON.parse(window.OpenDraftAndroidFold.snapshot()) : null;
  return {
    native,
    token: test?.token ?? null,
    viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width ?? null, visualHeight: visualViewport?.height ?? null },
    classes: [...document.documentElement.classList].filter(c => /^(fold|phone|wide)/.test(c)),
    browserSignals: { segments: window.viewport?.segments?.length ?? null,
      legacySegments: window.visualViewport?.segments?.length ?? null, devicePosture: navigator.devicePosture?.type ?? null },
    input: { focused: document.activeElement === area, readOnly: area?.readOnly ?? null,
      value: area?.value ?? null, selectionStart: area?.selectionStart ?? null, selectionEnd: area?.selectionEnd ?? null },
    invariants: {
      sameEditor: !!test && test.element === document.querySelector('.ProseMirror'),
      documentIntact: !!test && test.editor.state.doc.eq(test.doc),
      selectionIntact: !!test && test.editor.state.selection.from === test.from && test.editor.state.selection.to === test.to,
      samePad: !!test && area === test.area,
      draftIntact: !!test && area?.value === test.expectedPad,
      padSelectionIntact: !!test && area?.selectionStart === test.padFrom && area?.selectionEnd === test.padTo,
    },
  };
}

export function prepareKeyboard() {
  const area = document.querySelector('.scribble-area');
  const toggle = [...document.querySelectorAll('.scribble-toggle')].find(b => b.textContent.trim() === 'Keyboard');
  if (!area || !toggle) return false;
  if (toggle.getAttribute('aria-pressed') !== 'true') { toggle.click(); return false; }
  const test = window.__foldTest;
  area.focus(); area.setSelectionRange(area.value.length, area.value.length);
  test.padFrom = area.selectionStart; test.padTo = area.selectionEnd;
  if (document.activeElement !== area || area.readOnly) return false;
  area.scrollIntoView({ block: 'center' });
  const r = area.getBoundingClientRect();
  const v = JSON.parse(window.OpenDraftAndroidFold.snapshot()).webView;
  if (r.width <= 0 || r.height <= 0 || v.width <= 0 || v.height <= 0) return false;
  return { x: Math.round(v.left + (r.left + r.width / 2) * v.width / innerWidth),
    y: Math.round(v.top + (r.top + r.height / 2) * v.height / innerHeight) };
}

export function acceptTypedPad(expected) {
  const area = document.querySelector('.scribble-area');
  if (document.activeElement !== area || area?.value !== expected) return false;
  const test = window.__foldTest;
  test.expectedPad = area.value; test.padFrom = area.selectionStart; test.padTo = area.selectionEnd;
  return true;
}

export function openExtraWindow() {
  if (!window.__TAURI_INTERNALS__?.invoke) throw new Error('Real Tauri IPC is missing');
  window.__TAURI_INTERNALS__.invoke('open_new_window').catch(error => { window.__foldTest.openError = String(error); });
  return true;
}
