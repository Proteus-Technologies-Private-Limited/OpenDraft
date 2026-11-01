#!/bin/bash
# Issue #179 on Windows: does updating from 2.8.0 remove the associations it
# registered (.txt among them) and put back what was there before?
#
# Compiles two NSIS programs and runs them under Wine in an x86 Debian
# container, then reads the registry back:
#   test-script/issue-179/legacy-2.8.0.nsi   the registry a 2.8.0 install left
#       (Tauri 2.11.4's own FileAssociation.nsh), plus Final Draft owning .fdx
#       beforehand, a reinstall that lost .txt's backup, and another app that
#       has since taken the class named "celtx"
#   test-script/issue-179/hooks-harness.nsi  src-tauri/nsis-hooks.nsh's
#       install / uninstall hooks, as the real installer runs them
# The 2.8.0 state is checked first as a control.
#
# Needs only Docker; first run builds an image (several minutes on Apple
# Silicon, under x86 emulation). Usage: ./test-script/test_issue_179_nsis_upgrade.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/issue-179/nsis"
TAURI_REF="tauri-cli-v2.11.4"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$ROOT/test-script/issue-179/"*.nsi "$ROOT/src-tauri/nsis-hooks.nsh" "$OUT/"
curl -fsSL "https://raw.githubusercontent.com/tauri-apps/tauri/$TAURI_REF/crates/tauri-bundler/src/bundle/windows/nsis/FileAssociation.nsh" \
  -o "$OUT/FileAssociation.nsh" || { echo "Could not download Tauri's FileAssociation.nsh"; exit 2; }

docker build -q -t opendraft-nsis-wine - >/dev/null <<'DOCKERFILE'
FROM --platform=linux/amd64 debian:bookworm
RUN dpkg --add-architecture i386 && apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nsis wine wine32 >/dev/null \
 && rm -rf /var/lib/apt/lists/*
DOCKERFILE

docker run --rm --platform linux/amd64 -v "$OUT:/work" -w /work opendraft-nsis-wine bash -c '
set -uo pipefail
export WINEARCH=win32 WINEPREFIX=/tmp/wineprefix WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
for args in "legacy-2.8.0.nsi" "-DHOOK=POSTINSTALL hooks-harness.nsi" "-DHOOK=PREUNINSTALL hooks-harness.nsi"; do
  makensis -V2 $args > /work/makensis.log 2>&1 || { echo "makensis failed: $args"; cat /work/makensis.log; exit 2; }
done
echo "compiled: $(ls *.exe | tr "\n" " ")"
wineboot -i >/dev/null 2>&1

C="HKLM\\Software\\Classes"
# Default value of a key ("" if unset or missing), a named value, key existence.
defval() { wine reg query "$C\\$1" /ve 2>/dev/null | tr -d "\r" | awk -F"REG_SZ" "NF>1{sub(/^[ \t]+/,\"\",\$2); print \$2}" | sed "s/^(value not set)$//"; }
named()  { wine reg query "$C\\$1" /v "$2" 2>/dev/null | tr -d "\r" | awk -F"REG_SZ" "NF>1{sub(/^[ \t]+/,\"\",\$2); print \$2}"; }
haskey() { wine reg query "$C\\$1" >/dev/null 2>&1 && echo yes || echo no; }
hasval() { wine reg query "$C\\$1" /v "$2" >/dev/null 2>&1 && echo yes || echo no; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1: \"$2\""; else echo "  FAIL  $1: got \"$2\", want \"$3\""; fail=1; fi; }
run() { wine "$1" /S; wineserver -w; }

run legacy-2.8.0.exe
echo; echo "== Control: after the 2.8.0 install =="
check ".txt opens with" "$(defval .txt)" "txt"
check ".txt class command" "$(defval "txt\\shell\\open\\command")" "C:\\Program Files\\OpenDraft\\opendraft.exe \"%1\""
check ".txt backup (lost by the reinstall)" "$(named .txt txt_backup)" "txt"
check ".fdx opens with" "$(defval .fdx)" "fdx"
check ".fdx backup" "$(named .fdx fdx_backup)" "FinalDraft.Document"

assert_cleaned() {
  check ".txt restored to Windows default" "$(defval .txt)" "txtfile"
  check ".txt backup value removed" "$(hasval .txt txt_backup)" "no"
  check "class txt removed" "$(haskey txt)" "no"
  check ".fdx restored to Final Draft" "$(defval .fdx)" "FinalDraft.Document"
  check "Final Draft class untouched" "$(defval "FinalDraft.Document\\shell\\open\\command")" "\"C:\\FinalDraft\\FinalDraft.exe\" \"%1\""
  check "class fdx removed" "$(haskey fdx)" "no"
  for e in fountain fadein highland wdz osf; do
    check ".$e has no default (had none before)" "$(defval .$e)" ""
    check "class $e removed" "$(haskey $e)" "no"
    check ".${e}_backup removed" "$(hasval .$e ${e}_backup)" "no"
  done
  check ".celtx left alone (class now belongs to Celtx)" "$(defval .celtx)" "celtx"
  check "Celtx class kept" "$(defval "celtx\\shell\\open\\command")" "\"C:\\Celtx\\Celtx.exe\" \"%1\""
  check ".odraft still OpenDraft own" "$(defval .odraft)" "odraft"
}

run hook-POSTINSTALL.exe
echo; echo "== After updating (install hook) =="
assert_cleaned
for e in fdx fountain fadein osf highland wdz celtx; do
  check "OpenDraft offered for .$e (Open With)" "$(hasval ".$e\\OpenWithProgids" "OpenDraft.Alternative.$e")" "yes"
done

run hook-POSTINSTALL.exe
echo; echo "== Updating again changes nothing =="
assert_cleaned

run hook-PREUNINSTALL.exe
echo; echo "== After uninstalling =="
for e in fdx fountain fadein osf highland wdz celtx; do
  check "Open With entry removed for .$e" "$(hasval ".$e\\OpenWithProgids" "OpenDraft.Alternative.$e")" "no"
done
check ".txt still Windows default" "$(defval .txt)" "txtfile"
check ".fdx still Final Draft" "$(defval .fdx)" "FinalDraft.Document"
echo; [ $fail -eq 0 ] && echo "ALL PASS" || echo "FAILURES"
exit $fail
' 2>&1 | tee "$OUT/nsis-upgrade.log"
exit "${PIPESTATUS[0]}"
