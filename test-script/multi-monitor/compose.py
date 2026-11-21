"""Render compose.html (the two-display mockup board) to a PNG.

    venv/bin/python test-script/multi-monitor/capture.py   # real app shots first
    venv/bin/python test-script/multi-monitor/compose.py

Writes test-script/output/multi-monitor/mockup.png.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'output' / 'multi-monitor'
SHOTS = ['main.png', 'cards.png', 'popout.png', 'menu.png']


def main():
    missing = [s for s in SHOTS if not (OUT / s).is_file()]
    if missing:
        sys.exit(f'Missing shots {missing}: run capture.py first.')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={'width': 1800, 'height': 1000}, device_scale_factor=2)
            page.goto((HERE / 'compose.html').as_uri())
            page.wait_for_load_state('load')
            page.locator('.board').screenshot(path=str(OUT / 'mockup.png'))
        finally:
            browser.close()
    print(OUT / 'mockup.png')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001 — report any render failure plainly
        sys.exit(f'compose failed: {type(e).__name__}: {e}')
