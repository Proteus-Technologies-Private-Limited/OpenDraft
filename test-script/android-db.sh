#!/bin/zsh
# Copy the OpenDraft SQLite DB (with WAL) off the Android emulator and run sqlite3 on it.
#   ./test-script/android-db.sh "select title, updated_at from scripts"
# SERIAL defaults to emulator-5556. Needs a debug (run-as-able) build.
ADB=~/Library/Android/sdk/platform-tools/adb
SERIAL=${SERIAL:-emulator-5556}
OUT=${0:A:h}/output/android-db
rm -rf $OUT; mkdir -p $OUT
for f in opendraft.db opendraft.db-wal opendraft.db-shm; do
  $ADB -s $SERIAL exec-out run-as com.proteus.opendraft cat $f > $OUT/$f 2>/dev/null || true
done
[ -s $OUT/opendraft.db ] || { echo "could not copy opendraft.db from $SERIAL" >&2; exit 1; }
sqlite3 $OUT/opendraft.db "$@"
