#!/usr/bin/env python3
"""
Rebuild a screenplay's elements from a typeset PDF, for the runtime check.

OpenDraft cannot import PDF, but the scripts with known on-screen runtimes —
the studio "For Your Consideration" releases — only come as PDF. A screenplay
PDF is laid out on a fixed grid, so each line's element can be recovered from
where it starts on the page:

    action / scene heading   the leftmost column (1.5" on a standard page)
    dialogue                 ~1.0" right of it
    parenthetical            ~1.5" right of it
    character cue            ~2.0-2.7" right of it
    transition               ~4.0"+ right of it (or a left-set "CUT TO:")

The action column is measured per document (the most common line start), so a
PDF that is shifted, scaled or on A4 still classifies. Page numbers, scene
numbers, revision asterisks, (MORE) and (CONTINUED) are dropped, and a speech
split across a page break is joined back into one, so nothing the PDF added
for pagination is counted twice.

Writes, per PDF, a JSON file the runtime harness reads:
    { "title", "pdfPages", "pageSize": [w, h], "doc": { "type": "doc", ... } }

Usage:
    python3 test-script/pdf_screenplay_to_json.py OUT_DIR file.pdf [...]
"""
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter

NS = '{http://www.w3.org/1999/xhtml}'
PT = 72.0

HEADING_RE = re.compile(r'^(INT|EXT|I/E|INT\./EXT|EXT\./INT|INT/EXT|EXT/INT|EST)[\.\s/]', re.I)
TRANSITION_RE = re.compile(r'^[A-Z\s\.\']+(TO:|TO\s*-|TO\.)$|^(FADE (IN|OUT)|SMASH CUT|CUT TO|DISSOLVE|FADE TO BLACK|CUT TO BLACK)\b')
SCENE_NO_RE = re.compile(r'^[A-Z]?\d+[A-Z]{0,3}\.?$|^\*+$')
SKIP_LINE_RE = re.compile(r'^\(?\s*(MORE|CONTINUED|CONT\'D|CONTINUED:)\s*\)?:?$', re.I)
CONTD_RE = re.compile(r'\s*\((CONT\'D|CONT’D|CONTINUING|CONT)\)\s*$', re.I)


def load_pages(pdf):
    xml = subprocess.run(['pdftotext', '-bbox-layout', pdf, '-'], capture_output=True, check=True).stdout
    # pdftotext emits a DOCTYPE with no DTD; ElementTree handles the body fine.
    root = ET.fromstring(xml.split(b'?>', 1)[-1] if xml.startswith(b'<?xml') else xml)
    pages = []
    for page in root.iter(NS + 'page'):
        w, h = float(page.get('width')), float(page.get('height'))
        lines = []
        for line in page.iter(NS + 'line'):
            words = [(float(wd.get('xMin')), float(wd.get('xMax')), wd.text or '') for wd in line.iter(NS + 'word')]
            if not words:
                continue
            y = float(line.get('yMin'))
            lines.append({'y': y, 'h': float(line.get('yMax')) - y, 'words': words})
        lines.sort(key=lambda l: (round(l['y'], 0), l['words'][0][0]))
        pages.append({'w': w, 'h': h, 'lines': lines})
    return pages


def clean_words(words, page_w, anchor):
    """Drop scene numbers in the margins and revision asterisks."""
    out = []
    for x0, x1, t in words:
        in_left_margin = x0 < anchor - 0.25 * PT
        in_right_margin = x0 > page_w - 1.15 * PT
        if (in_left_margin or in_right_margin) and SCENE_NO_RE.match(t):
            continue
        if t.strip('*') == '':
            continue
        out.append((x0, x1, t))
    return out


def classify(dx_in, text, prev_type):
    upper = text.upper() == text and any(c.isalpha() for c in text)
    if dx_in < 0.5:
        if HEADING_RE.match(text):
            return 'sceneHeading'
        if upper and TRANSITION_RE.match(text):
            return 'transition'
        return 'action'
    if dx_in >= 3.5:
        return 'transition'
    if text.startswith('(') or (prev_type == 'parenthetical' and 1.2 <= dx_in < 1.9):
        return 'parenthetical'
    if dx_in >= 1.9 and upper:
        return 'character'
    if dx_in < 1.9:
        return 'dialogue'
    # Centred, mixed-case: lyrics or a centred card. Treat as dialogue-width text.
    return 'dialogue'


def convert(pdf):
    pages = load_pages(pdf)

    # The first page with a scene heading or FADE IN opens the script proper;
    # everything before it is a cover, title page or FYC preamble.
    def page_text(p):
        return [' '.join(w[2] for w in l['words']) for l in p['lines']]
    start = next((i for i, p in enumerate(pages)
                  if any(HEADING_RE.match(t.strip()) or t.strip().upper().startswith('FADE IN') for t in page_text(p))), 0)
    body = pages[start:]

    starts = Counter()
    for p in body:
        for l in p['lines']:
            starts[round(l['words'][0][0] / 6) * 6] += 1
    # The action column is the most common start left of 2.2" from the edge.
    anchor = max((x for x in starts if x < 2.2 * PT), key=lambda x: starts[x])

    blocks = []          # [type, [lines], page, last_y]
    more_pending = None  # character whose speech ran over with (MORE)
    skip_contd_cue = False

    for pi, p in enumerate(body):
        line_h = 12.0
        for li, l in enumerate(p['lines']):
            words = clean_words(l['words'], p['w'], anchor)
            if not words:
                continue
            text = ' '.join(w[2] for w in words).strip()
            # Running header page number ("12." top right), footer counters.
            if l['y'] < 0.9 * PT and re.match(r'^\d+[A-Z]?\.?$', text):
                continue
            if l['y'] > p['h'] - 0.6 * PT and re.match(r'^\d+[A-Z]?\.?$', text):
                continue
            if SKIP_LINE_RE.match(text):
                if text.strip('()').upper().startswith('MORE') and blocks:
                    more_pending = True
                continue
            dx = (words[0][0] - anchor) / PT
            prev = blocks[-1] if blocks else None
            t = classify(dx, text, prev[0] if prev else None)

            # A speech continued from the last page: drop the repeated cue and
            # let its dialogue join the speech it belongs to.
            if t == 'character' and more_pending and CONTD_RE.search(text):
                more_pending = None
                skip_contd_cue = True
                continue
            more_pending = None

            same_page = prev is not None and prev[2] == pi
            gap = (l['y'] - prev[3]) if same_page else 999
            joins = prev is not None and prev[0] == t and (gap <= line_h * 1.25 or skip_contd_cue)
            if t in ('sceneHeading', 'character', 'transition'):
                joins = joins and gap <= line_h * 1.25 and t != 'character'
            skip_contd_cue = False
            if joins:
                prev[1].append(text)
                prev[2], prev[3] = pi, l['y']
            else:
                blocks.append([t, [text], pi, l['y']])

    doc = {'type': 'doc', 'content': [
        {'type': t, 'content': [{'type': 'text', 'text': ' '.join(lines)}]} for t, lines, _, _ in blocks
    ]}
    return {
        'title': os.path.splitext(os.path.basename(pdf))[0],
        'pdfPages': len(body),
        'pageSize': [pages[0]['w'] / PT, pages[0]['h'] / PT],
        'anchorInches': round(anchor / PT, 2),
        'counts': dict(Counter(b[0] for b in blocks)),
        'doc': doc,
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    for pdf in sys.argv[2:]:
        try:
            result = convert(pdf)
        except Exception as err:  # keep going: one bad PDF should not stop the batch
            print(f'FAILED {pdf}: {err}', file=sys.stderr)
            continue
        path = os.path.join(out_dir, result['title'] + '.json')
        with open(path, 'w') as fh:
            json.dump(result, fh)
        print(f"{result['title']:<22} pages={result['pdfPages']:<4} anchor={result['anchorInches']}\" {result['counts']}")


if __name__ == '__main__':
    main()
