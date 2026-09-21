#!/usr/bin/env bash
#
# Reproduce (and verify the fix for) the JNI pending-exception SIGABRT.
#
# Why this exists
# ---------------
# A crash reported from a vivo Y200 5G on 0.23.0:
#
#   JNI DETECTED ERROR IN APPLICATION: JNI FindClass called with pending
#   exception java.lang.SecurityException: Permission Denial: opening provider
#   com.android.providers.contacts.ContactsProvider2 ... requires
#   android.permission.READ_CONTACTS
#
# The path is android_read_content_uri -> android_query_display_name ->
# ContentResolver.query(). The query throws; every exit in that helper is an
# `.ok()?`, which discards the error and returns None with the exception STILL
# PENDING on the thread. The caller reads None as "no display name, use the
# fallback" and carries on to openInputStream. That next JNI call is where ART
# notices the pending exception and aborts the process -- two calls away from
# the code that actually failed.
#
# THE POINT: the app must SURVIVE this intent and report a normal error. A
# process that vanishes is the bug. This script asserts on the process's own
# pid: same pid before and after means it never died.
#
# CheckJNI must be on for ART to abort rather than limp along. It is on by
# default on emulator images, which is why this is an emulator test.
#
# Usage
#   ./test-script/android-jni-pending-exception.sh                 # first device
#   ./test-script/android-jni-pending-exception.sh emulator-5558   # pick one
#
# Exit status
#   0  app survived the hostile intent  (fix present and working)
#   1  app died                         (bug reproduced)
#   2  test could not run / was inconclusive
#
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

APP_ID="com.proteus.opendraft"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${1:-}"
OUT_DIR="$PROJECT_ROOT/test-script/output/jni-pending-exception"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"

# The hostile URI: a provider this app holds no permission for, so the query
# throws SecurityException. Any provider that denies us would do.
HOSTILE_URI="content://com.android.contacts/contacts/1"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { red "ERROR: $*"; exit 2; }

[[ -x "$ADB" ]] || die "adb not found at $ADB (set ADB=/path/to/adb)"
mkdir -p "$OUT_DIR"

if [[ -z "$SERIAL" ]]; then
  SERIAL="$($ADB devices | awk '/\tdevice$/ {print $1; exit}')"
  [[ -n "$SERIAL" ]] || die "no device attached"
fi
adbs() { "$ADB" -s "$SERIAL" "$@"; }

adbs shell pm list packages 2>/dev/null | grep -q "package:$APP_ID" \
  || die "$APP_ID is not installed on $SERIAL"

bold "Device:  $SERIAL  ($(adbs shell getprop ro.product.cpu.abi | tr -d '\r'), Android $(adbs shell getprop ro.build.version.release | tr -d '\r'))"
bold "Package: $APP_ID  (versionName $(adbs shell dumpsys package "$APP_ID" | awk -F= '/versionName/{print $2; exit}' | tr -d '\r'))"
echo

pid_of() { adbs shell pidof "$APP_ID" 2>/dev/null | tr -d '\r' | awk '{print $1}'; }

# ── Phase 1: start clean, get the app up and note its pid ────────────────────
bold "1. Cold-starting the app normally"
adbs shell am force-stop "$APP_ID" >/dev/null 2>&1
sleep 2
adbs logcat -c >/dev/null 2>&1 || true
adbs shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1 || die "could not launch $APP_ID"

for _ in $(seq 1 "$SETTLE_SECONDS"); do
  PID_BEFORE="$(pid_of)"
  [[ -n "$PID_BEFORE" ]] && break
  sleep 1
done
[[ -n "${PID_BEFORE:-}" ]] || die "app never came up"
sleep 5   # let the webview finish loading before we poke it
PID_BEFORE="$(pid_of)"
echo "   up as pid $PID_BEFORE"
echo

# ── Phase 2: fire the hostile intent at the running app ──────────────────────
bold "2. Sending the hostile VIEW intent"
echo "   $HOSTILE_URI"
adbs shell am start -a android.intent.action.VIEW \
  -d "$HOSTILE_URI" -t "text/plain" \
  -n "$APP_ID/.MainActivity" >/dev/null 2>&1

for _ in $(seq 1 "$SETTLE_SECONDS"); do
  sleep 1
  [[ -z "$(pid_of)" ]] && break
done
PID_AFTER="$(pid_of)"
echo

# ── Phase 3: collect evidence before judging ─────────────────────────────────
LOG="$OUT_DIR/logcat-$(date +%Y%m%d-%H%M%S).txt"
adbs logcat -d > "$LOG" 2>/dev/null || true
adbs shell screencap -p /sdcard/jni-test.png >/dev/null 2>&1 \
  && adbs pull /sdcard/jni-test.png "$OUT_DIR/after-intent.png" >/dev/null 2>&1 || true

bold "3. What the log says"
# grep -c prints 0 and exits 1 when it matches nothing, so `|| echo 0` would
# make the value the two-line string "0\n0" and defeat the == "0" test below.
count_in_log() { grep -cE "$1" "$LOG" 2>/dev/null | head -1; }
JNI_ERR="$(count_in_log "JNI DETECTED ERROR")"
ABORT="$(count_in_log "Fatal signal|SIGABRT|>>> $APP_ID <<<")"
REACHED="$(count_in_log "content-uri|readUriBytes|SecurityException|Permission Denial")"

echo "   JNI DETECTED ERROR lines : $JNI_ERR"
echo "   abort / tombstone lines  : $ABORT"
echo "   content-uri path touched : $REACHED"
grep -E "content-uri|readUriBytes failed|Permission Denial|JNI DETECTED ERROR" "$LOG" 2>/dev/null \
  | head -8 | sed 's/^/   | /'
echo
echo "   full log: $LOG"
echo

# ── Verdict ──────────────────────────────────────────────────────────────────
bold "Verdict"
if [[ -z "$PID_AFTER" ]]; then
  red "FAIL - process died. pid $PID_BEFORE is gone."
  red "       The pending exception aborted the app. Bug reproduced."
  exit 1
fi
if [[ "$PID_AFTER" != "$PID_BEFORE" ]]; then
  red "FAIL - process restarted: pid $PID_BEFORE -> $PID_AFTER."
  red "       It died and Android brought it back. Bug reproduced."
  exit 1
fi
if [[ "$REACHED" == "0" ]]; then
  red "INCONCLUSIVE - app survived, but nothing in the log shows the"
  red "       content-uri path ran. The intent may not have been delivered,"
  red "       so surviving it proves nothing. Check $LOG."
  exit 2
fi
green "PASS - same pid $PID_AFTER throughout. The app took the denied URI,"
green "       failed it, and stayed alive."
exit 0
