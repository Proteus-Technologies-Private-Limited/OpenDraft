#!/usr/bin/env bash
# Upgrade test on an iOS simulator: 2.14.2's data, images included, in the current app.
#
#   OD_SIM_UDID=<udid> OD_TEST_IMAGES=<dir> test-script/upgrade_compat/run.sh <old.app> <new.app>
#
# Build the two apps with build_sim_app.sh (old: a dist built from
# `git archive v2.14.2 frontend`). Needs the Bash sandbox off: the simulator's
# web-inspector socket is outside it. Wipes OpenDraft's data on that simulator.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OLD="$1"; NEW="$2"
: "${OD_SIM_UDID:?set OD_SIM_UDID}"; : "${OD_TEST_IMAGES:?set OD_TEST_IMAGES}"
PY="$ROOT/venv/bin/python -u $ROOT/test-script/upgrade_compat/ios_upgrade.py"
B=com.proteus.opendraft
launch() { xcrun simctl terminate "$OD_SIM_UDID" $B >/dev/null 2>&1 || true; xcrun simctl launch "$OD_SIM_UDID" $B >/dev/null; sleep 8; }

echo "== fresh install of the old app"
xcrun simctl uninstall "$OD_SIM_UDID" $B >/dev/null 2>&1 || true
xcrun simctl install "$OD_SIM_UDID" "$OLD"; launch
$PY populate > "$ROOT/test-script/output/upgrade_compat/populate.log"
echo "   populated: $(python3 -c "import json;m=json.load(open('$ROOT/test-script/output/upgrade_compat/manifest.json'));print(', '.join(m['characters']))")"

echo "== upgrade: install the current app over it"
xcrun simctl terminate "$OD_SIM_UDID" $B >/dev/null 2>&1 || true
xcrun simctl install "$OD_SIM_UDID" "$NEW"; launch
status=0
$PY verify after_upgrade || status=1
echo "== new features, then a relaunch"
$PY features || status=1
exit $status
