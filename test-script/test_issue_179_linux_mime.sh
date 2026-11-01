#!/bin/bash
# Issue #179 on Linux: which file types does OpenDraft's desktop entry claim?
#
# Renders src-tauri/linux/opendraft.desktop the way Tauri's bundler does,
# installs it and src-tauri/linux/opendraft-mime.xml into a Debian container
# with the real freedesktop tools, and checks:
#   - every screenplay extension resolves to its own MIME type, handled by OpenDraft
#   - plain text, XML, ZIP and JSON files are NOT handled by OpenDraft
#   - the entry passes desktop-file-validate and passes the file (Exec %F)
# 2.8.0's entry (generic types, no %F) is checked the same way as a control:
# it must fail, or the test proves nothing.
#
# Needs only Docker. Usage: ./test-script/test_issue_179_linux_mime.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/issue-179"
mkdir -p "$OUT"

# Tauri's DesktopTemplateParams for this app (crates/tauri-bundler/src/bundle/
# linux/freedesktop/mod.rs, 2.11.4): mime_type is the associations' mimeType
# values joined with ';'.
MIME_TYPES=$(python3 -c "
import json
c = json.load(open('$ROOT/src-tauri/tauri.linux.conf.json'))
print(';'.join(a['mimeType'] for a in c['bundle']['fileAssociations']))")

python3 - "$ROOT/src-tauri/linux/opendraft.desktop" "$OUT/opendraft.desktop" "$MIME_TYPES" <<'PY'
import re, sys
src, dst, mime = sys.argv[1:4]
values = {"categories": "Office;", "comment": "OpenDraft - Professional Screenwriting Application",
          "exec": "opendraft", "icon": "opendraft", "name": "OpenDraft", "mime_type": mime}
text = open(src).read()
# The two Handlebars forms the template uses: {{#if x}}...{{/if}} and {{x}}.
text = re.sub(r"\{\{#if (\w+)\}\}\n?(.*?)\{\{/if\}\}\n?",
              lambda m: m.group(2) if values.get(m.group(1)) else "", text, flags=re.S)
text = re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], text)
open(dst, "w").write(text)
PY

# 2.8.0's entry, as shipped in OpenDraft_2.8.0_amd64.deb.
cat > "$OUT/opendraft-2.8.0.desktop" <<'DESK'
[Desktop Entry]
Categories=Office;
Comment=OpenDraft - Professional Screenwriting Application
Exec=opendraft
StartupWMClass=opendraft
Icon=opendraft
Name=OpenDraft
Terminal=false
Type=Application
MimeType=application/xml;text/plain;application/zip;application/zip;application/zip;application/zip;application/xml;application/json;text/plain
DESK

cp "$ROOT/src-tauri/linux/opendraft-mime.xml" "$OUT/opendraft-mime.xml"
echo "Rendered desktop entry:"; sed 's/^/  /' "$OUT/opendraft.desktop"

docker run --rm -v "$OUT:/work" debian:bookworm bash -c '
set -uo pipefail
apt-get update -qq >/dev/null && apt-get install -y -qq shared-mime-info desktop-file-utils xdg-utils >/dev/null 2>&1 || { echo "apt failed"; exit 2; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1: $2"; else echo "  FAIL  $1: got \"$2\", want \"$3\""; fail=1; fi; }
mkdir -p /tmp/files && cd /tmp/files
for f in a.odraft a.fountain a.fdx a.fadein a.osf a.highland a.wdz a.celtx notes.txt data.xml archive.zip data.json; do : > "$f"; done
# Content so magic-based detection agrees with the extension where it applies.
echo "{}" > a.odraft; echo "{}" > data.json; echo "<a/>" > data.xml; echo "<a/>" > a.fdx; echo "<a/>" > a.osf
echo "hello" > notes.txt; echo "INT. ROOM - DAY" > a.fountain

query_default() { xdg-mime query default "$1" 2>/dev/null || true; }

install_entry() {
  rm -f /usr/share/applications/opendraft.desktop /usr/share/mime/packages/opendraft.xml
  cp "$1" /usr/share/applications/opendraft.desktop
  [ -n "${2:-}" ] && cp "$2" /usr/share/mime/packages/opendraft.xml
  update-mime-database /usr/share/mime >/dev/null 2>&1
  update-desktop-database /usr/share/applications >/dev/null 2>&1
}

echo; echo "== Control: 2.8.0 desktop entry (must claim generic types) =="
install_entry /work/opendraft-2.8.0.desktop
claimed=0
for t in text/plain application/zip application/json application/xml; do
  [ "$(query_default $t)" = "opendraft.desktop" ] && { echo "  2.8.0 handles $t"; claimed=$((claimed+1)); }
done
if [ $claimed -eq 4 ]; then echo "  PASS  control reproduces #179 (4 of 4 generic types claimed)"; else echo "  FAIL  control did not reproduce the bug ($claimed of 4)"; fail=1; fi

echo; echo "== Fixed desktop entry + MIME types =="
install_entry /work/opendraft.desktop /work/opendraft-mime.xml
desktop-file-validate /usr/share/applications/opendraft.desktop > /work/desktop-file-validate.log 2>&1
check "desktop-file-validate" "$(wc -l < /work/desktop-file-validate.log | tr -d " ") messages" "0 messages"
check "Exec passes the file" "$(grep "^Exec=" /usr/share/applications/opendraft.desktop)" "Exec=opendraft %F"
for pair in a.odraft:application/x-opendraft a.fountain:text/x-fountain a.fdx:application/x-fdx \
            a.fadein:application/x-fadein a.osf:application/x-open-screenplay-format \
            a.highland:application/x-highland a.wdz:application/x-writerduet a.celtx:application/x-celtx; do
  file=${pair%%:*}; want=${pair#*:}
  check "type of $file" "$(xdg-mime query filetype $file)" "$want"
  check "handler for $want" "$(query_default $want)" "opendraft.desktop"
done
for pair in notes.txt:text/plain data.xml:application/xml archive.zip:application/zip data.json:application/json; do
  file=${pair%%:*}; t=${pair#*:}
  check "type of $file" "$(xdg-mime query filetype $file)" "$t"
  check "handler for $t (must not be OpenDraft)" "$(query_default $t)" ""
done
echo; [ $fail -eq 0 ] && echo "ALL PASS" || echo "FAILURES"
exit $fail
' 2>&1 | tee "$OUT/linux-mime.log"
exit "${PIPESTATUS[0]}"
