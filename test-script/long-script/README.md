# Long-script interaction regressions

Run Vite, then from the repository root:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/long-script/regressions.py
OPENDRAFT_BROWSER=webkit OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/long-script/regressions.py
```

Install Python Playwright 1.62.0 and its browser dependencies first. Chromium is
the default; `OPENDRAFT_CHROMIUM` can select an executable. WebKit uses the
Playwright build installed by `python -m playwright install --with-deps webkit`.

Four cases exercise Navigator off/on × spellcheck off/on. Each loads the shared
synthetic screenplay from `frontend/src/test/fixtures/longScreenplay.mjs`, the
same generator used by `test-script/typing-lag.mjs`. Size 182 renders about 150
pages; the test checks the actual page count is at least 140, allowing installed
font differences. The editor has more than 3,000 mixed screenplay blocks.

Each case checks forward/backward wheel scrolling without moving the caret or
changing the document; editing in the middle; repeated Backspace down events
with `repeat=true` after the first; exact restoration of text/selection; and
keyboard undo. The undo probe gets an explicit history boundary so the check is
independent of the speed of the preceding key burst. Spellcheck cases verify
that decorations really appear or disappear. No user file is saved or downloaded; isolated browser storage contains only fixtures.

Set `OPENDRAFT_LONG_SCRIPT_OUTPUT` to retain a JSON result per case, including
browser/version, page and block counts, final caret and key count. CI uploads
these with the accessibility evidence for each browser.

These are behavior checks, not latency budgets. They run against Vite and make
no native-driver, compositor, physical keyboard-repeat, IME or Safari claim.
Use the production profiling procedure in
[the #229 investigation](../../docs/performance/issue-229-typing.md) for timing.
Linux Playwright WebKit is additional engine coverage; the reporter's actual
Fedora/WebKitGTK/GPU setup still needs a native retest.
