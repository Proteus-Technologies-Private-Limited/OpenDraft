"""Capture the real OpenDraft screens used in the multi-monitor mockup.

Runs against the Vite dev server (the one already running in another terminal):

    venv/bin/python test-script/multi-monitor/capture.py

Writes PNGs to test-script/output/multi-monitor/. compose.py then lays them out
on two displays. The demo screenplay is the App Store one (appstore/demo_script.py).

Shots:
  main.png         the main window: script + Navigator, scene 3 selected
  cards.png        a panel window showing only Index Cards (proposed chrome injected)
  popout.png       the split-screen Index Cards pane with the proposed pop-out button
  menu.png         View menu with the proposed "Move to New Window" entries
"""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, Error as PlaywrightError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'test-script' / 'appstore'))
from demo_script import build_document, TITLE  # noqa: E402

URL = os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/')
OUT = ROOT / 'test-script' / 'output' / 'multi-monitor'
W, H = 1440, 900
SCALE = 2

# Chrome proposed for a panel window: no menu bar or toolbar of its own, only a
# slim header that names the script and offers to put the panel back.
PANEL_WINDOW_CSS = """
.menu-bar, .toolbar, .workspace-dock, .panel-resize-handle, .status-bar-wrap,
.status-bar-row, .scene-strip { display: none !important; }
.od-panel-window-bar {
  height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 12px;
  border-bottom: 1px solid var(--border-color, #d9dce1);
  background: var(--toolbar-bg, var(--bg-secondary, #f4f5f7));
  font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--text-secondary, #555); flex: 0 0 auto;
}
.od-panel-window-bar b { color: var(--text-primary, #222); font-weight: 600; }
.od-panel-window-bar .sp { flex: 1; }
.od-panel-window-bar .live { display: inline-flex; align-items: center; gap: 6px; }
.od-panel-window-bar .live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #22a06b; }
.od-panel-window-bar button {
  font: inherit; padding: 4px 10px; border-radius: 5px; cursor: default;
  border: 1px solid var(--border-color, #cfd3da); background: var(--bg-primary, #fff);
  color: var(--text-primary, #222);
}
"""

PANEL_BAR_JS = """([name, title]) => {
  const app = document.querySelector('.app-container');
  const bar = document.createElement('div');
  bar.className = 'od-panel-window-bar';
  bar.innerHTML = `<b>${name}</b><span>·</span><span>${title}</span><span class="sp"></span>
    <span class="live">Live with main window</span>
    <button>⤓ Return to Main Window</button>`;
  app.insertBefore(bar, app.firstChild);
}"""

POPOUT_JS = """() => {
  const pane = document.querySelector('.split-pane');
  if (!pane) return 'no split pane';
  const close = pane.querySelector('.split-pane-close, [class*="close"]');
  const btn = document.createElement('button');
  btn.textContent = '⧉';
  btn.title = 'Move to New Window';
  btn.style.cssText = 'position:absolute;z-index:50;width:26px;height:26px;border-radius:6px;' +
    'border:2px solid #2563eb;background:#eff4ff;color:#2563eb;font-size:15px;line-height:20px;';
  const tip = document.createElement('div');
  tip.textContent = 'Move to New Window  ⇧⌘N';
  tip.style.cssText = 'position:absolute;z-index:51;padding:5px 9px;border-radius:5px;background:#1f2329;' +
    'color:#fff;font:12px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;';
  pane.style.position = 'relative';
  const pr = pane.getBoundingClientRect();
  let top = 8, right = 40;
  if (close) {
    const cr = close.getBoundingClientRect();
    top = cr.top - pr.top + (cr.height - 26) / 2;
    right = pr.right - cr.left + 6;
  }
  btn.style.top = top + 'px'; btn.style.right = right + 'px';
  tip.style.top = (top + 32) + 'px'; tip.style.right = right + 'px';
  pane.appendChild(btn); pane.appendChild(tip);
  return 'ok';
}"""


# The proposed View ▸ Panels entry, built by cloning a real row so it looks native.
MENU_JS = """() => {
  const rows = [...document.querySelectorAll('.menu-dropdown-item')].filter(r => r.getBoundingClientRect().width > 0);
  const split = rows.find(r => r.innerText.trim().startsWith('Split Screen'));
  if (!split) return 'no split row';
  const row = split.cloneNode(true);
  const labelEl = [...row.querySelectorAll('span')].find(s => s.innerText.trim().startsWith('Split Screen'));
  if (labelEl) labelEl.textContent = 'Move to New Window';
  row.querySelectorAll('.menu-check, [class*="check"]').forEach(c => c.style.visibility = 'hidden');
  row.style.background = '#eaf1ff'; row.style.outline = '2px solid #2563eb'; row.style.outlineOffset = '-2px'; row.style.borderRadius = '4px';
  split.parentNode.insertBefore(row, split.nextSibling);
  const sub = document.createElement('div');
  const r = row.getBoundingClientRect();
  sub.style.cssText = `position:fixed;left:${r.right + 2}px;top:${r.top - 4}px;z-index:9999;min-width:230px;padding:4px;` +
    'background:var(--menu-bg, #fff);border:1px solid var(--border-color, #d0d4da);border-radius:6px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text-primary,#222);';
  const items = [['Navigator',''],['Index Cards','⇧⌘N'],['Beat Board',''],['Outline',''],['Page View',''],['—',''],['Return All Panels to This Window','']];
  sub.innerHTML = items.map(([t,k]) => t === '—' ? '<div style="height:1px;margin:4px 6px;background:var(--border-color,#e2e5ea)"></div>' :
    `<div style="display:flex;justify-content:space-between;gap:24px;padding:6px 12px;border-radius:4px;${t==='Index Cards'?'background:#2563eb;color:#fff':''}">` +
    `<span>${t}</span><span style="opacity:.6">${k}</span></div>`).join('');
  document.body.appendChild(sub);
  return 'ok';
}"""


def view_state(**extra):
    state = {'navigatorOpen': False, 'indexCardsOpen': False, 'beatBoardOpen': False}
    state.update(extra)
    return json.dumps(state)


def open_page(browser, state_json, theme='light'):
    context = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=SCALE)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(
        f"localStorage.setItem('opendraft:viewState', {json.dumps(state_json)});"
        f"localStorage.setItem('opendraft:theme', {json.dumps(theme)});"
    )
    page.goto(URL, wait_until='domcontentloaded')
    page.locator('.app-container').wait_for(timeout=30000)
    blank = page.get_by_role('button', name='Blank Document', exact=False)
    if blank.count():
        blank.first.click()
    page.locator('.ProseMirror').first.wait_for(timeout=30000)
    load_demo(page)
    return context, page, errors


def load_demo(page):
    doc = build_document()
    page.evaluate("""(doc) => {
      const el = document.querySelector('.ProseMirror');
      if (!el || !el.editor) throw new Error('editor not mounted');
      el.editor.commands.setContent(doc, true);
      el.editor.commands.setTextSelection(1);
    }""", doc)
    page.wait_for_timeout(900)


def name_script(page):
    """Show the demo title where the status bar would say Untitled Screenplay."""
    page.evaluate("""(title) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) if (n.nodeValue.trim() === 'Untitled Screenplay') n.nodeValue = title;
    }""", TITLE)


def scroll_to_scene(page, index):
    page.evaluate("""(i) => {
      const h = document.querySelectorAll('.ProseMirror [class*="scene-heading"], .ProseMirror h2, .ProseMirror .sceneHeading')[i];
      const main = document.querySelector('.editor-main');
      if (h && main) main.scrollTop += h.getBoundingClientRect().top - main.getBoundingClientRect().top - 60;
    }""", index)
    page.wait_for_timeout(400)


def select_scene(page, index):
    """Put the caret in scene `index` (0-based) so the Navigator and cards highlight it."""
    page.evaluate("""(i) => {
      const ed = document.querySelector('.ProseMirror').editor;
      let n = -1, pos = 1;
      ed.state.doc.descendants((node, p) => {
        if (node.type.name === 'sceneHeading') { n++; if (n === i) { pos = p + 1; return false; } }
      });
      ed.commands.setTextSelection(pos);
      ed.commands.focus();
    }""", index)
    page.wait_for_timeout(500)


def menu_row(page, label):
    """The visible menu row whose label is exactly `label`."""
    rows = page.locator('.menu-dropdown-item:visible')
    for i in range(rows.count()):
        row = rows.nth(i)
        text = row.locator('.menu-dropdown-label, span').first.inner_text().strip() if row.locator('span').count() else row.inner_text().strip()
        if text == label or row.inner_text().strip().split('\n')[0].strip() == label:
            return row
    raise RuntimeError(f'menu row not found: {label}')


def open_menu(page, top, *path):
    """Open `top` and hover through `path`, leaving the last submenu open."""
    page.locator('.menu-item').filter(has=page.get_by_text(top, exact=True)).first.click()
    page.wait_for_timeout(250)
    for label in path:
        menu_row(page, label).hover()
        page.wait_for_timeout(300)


def click_menu(page, top, *path):
    open_menu(page, top, *path[:-1])
    menu_row(page, path[-1]).click()
    page.wait_for_timeout(500)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            # 1. Main window: script + Navigator, caret in scene 3.
            ctx, page, errors = open_page(browser, view_state(navigatorOpen=True))
            select_scene(page, 2)
            scroll_to_scene(page, 2)
            name_script(page)
            page.screenshot(path=str(OUT / 'main.png'))
            print('main.png', errors or 'ok')
            ctx.close()

            # 2. Panel window: Index Cards only.
            ctx, page, errors = open_page(browser, view_state())
            select_scene(page, 2)
            click_menu(page, 'View', 'Panels', 'Index Cards')
            page.add_style_tag(content=PANEL_WINDOW_CSS)
            page.evaluate(PANEL_BAR_JS, ['Index Cards', TITLE])
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / 'cards.png'))
            print('cards.png', errors or 'ok')
            ctx.close()

            # 4. Split-screen Index Cards with the proposed pop-out button.
            ctx, page, errors = open_page(browser, view_state(navigatorOpen=True))
            select_scene(page, 2)
            click_menu(page, 'View', 'Panels', 'Split Screen', 'Side by Side')
            page.keyboard.press('Escape')
            page.wait_for_timeout(500)
            name_script(page)
            print('popout inject:', page.evaluate(POPOUT_JS))
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / 'popout.png'))
            print('popout.png', errors or 'ok')
            ctx.close()

            # 5. View ▸ Panels with the proposed "Move to New Window" entries.
            ctx, page, errors = open_page(browser, view_state(navigatorOpen=True))
            name_script(page)
            open_menu(page, 'View', 'Panels')
            print('menu inject:', page.evaluate(MENU_JS))
            menu_row(page, 'Move to New Window').hover()
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / 'menu.png'))
            print('menu.png', errors or 'ok')
            ctx.close()
        finally:
            browser.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001 — report any capture failure plainly
        sys.exit(f'capture failed: {type(e).__name__}: {e}')
