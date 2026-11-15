// These self-contained functions are serialized into the native webview.
export function startMeasurement() {
  const b = window.__nativeBench;
  const scroller = document.querySelector('.editor-main');
  if (b.measure) {
    b.measure.active = false;
    cancelAnimationFrame(b.measure.rafId);
    scroller.removeEventListener('wheel', b.onWheel);
    scroller.removeEventListener('scroll', b.onScroll);
  }
  const m = {
    frames: [],
    wheels: [],
    scrolls: [],
    startTop: scroller.scrollTop,
    last: null,
    active: true,
  };
  b.measure = m;
  b.onWheel = (event) => {
    if (event.target.closest('.editor-main')) {
      m.wheels.push({ trusted: event.isTrusted, delta: event.deltaY });
    }
  };
  b.onScroll = () => m.scrolls.push({ time: performance.now(), top: scroller.scrollTop });
  scroller.addEventListener('wheel', b.onWheel, { passive: true });
  scroller.addEventListener('scroll', b.onScroll, { passive: true });
  // Capture this phase. Reading b.measure here leaks an old loop into the next.
  const frame = (time) => {
    if (!m.active) return;
    if (m.last !== null) m.frames.push(time - m.last);
    m.last = time;
    m.rafId = requestAnimationFrame(frame);
  };
  m.rafId = requestAnimationFrame(frame);
}

export function stopMeasurement() {
  const b = window.__nativeBench;
  const m = b?.measure;
  if (!m) return null;
  const scroller = document.querySelector('.editor-main');
  m.active = false;
  cancelAnimationFrame(m.rafId);
  scroller.removeEventListener('wheel', b.onWheel);
  scroller.removeEventListener('scroll', b.onScroll);
  const sorted = [...m.frames].sort((a, b) => a - b);
  const percentile = (n) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))];
  return {
    frameCount: sorted.length,
    frameMs: {
      median: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: sorted.at(-1),
      over33: sorted.filter((t) => t > 33.34).length,
      over50: sorted.filter((t) => t > 50).length,
    },
    wheelEvents: m.wheels.length,
    trustedWheels: m.wheels.filter((w) => w.trusted).length,
    wheelDelta: m.wheels.reduce((sum, w) => sum + w.delta, 0),
    scrollEvents: m.scrolls.length,
    distance: scroller.scrollTop - m.startTop,
    documentIntact: b.editor.state.doc.eq(b.documentBefore),
    selectionIntact:
      b.editor.state.selection.from === b.selection.from &&
      b.editor.state.selection.to === b.selection.to,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    navigatorScenes: document.querySelector('.scene-count')?.textContent ?? null,
    spellMarks: document.querySelectorAll('.spell-error').length,
  };
}
