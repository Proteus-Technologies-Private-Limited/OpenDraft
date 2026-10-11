#!/bin/zsh
# Copy the WriTea Draft SQLite DB (with WAL) off the Android emulator and run sqlite3 on it.
#   ./test-script/android-db.sh "select title, updated_at from scripts"
# SERIAL defaults to emulator-5556. Needs a debug (run-as-able) build.
ADB=~/Library/Android/sdk/platform-tools/adb
SERIAL=${SERIAL:-emulator-5556}
OUT=${0:A:h}/output/android-db
rm -rf $OUT; mkdir -p $OUT
for f in writeadraft.db writeadraft.db-wal writeadraft.db-shm; do
  $ADB -s $SERIAL exec-out run-as net.japanada.writea-draft cat $f > $OUT/$f 2>/dev/null || true
done
[ -s $OUT/writeadraft.db ] || { echo "could not copy writeadraft.db from $SERIAL" >&2; exit 1; }
sqlite3 $OUT/writeadraft.db "$@"
