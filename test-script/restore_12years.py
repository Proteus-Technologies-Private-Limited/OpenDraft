#!/usr/bin/env python3
"""Restore the blanked `12_Years_a_Slave` script from a pre-corruption Time
Machine snapshot back into the live OpenDraft SQLite DB.

Faithfully copies the snapshot row's content/size/updated_at. Makes a fresh
timestamped backup of the live DB before writing. Read the snapshot read-only.

Run ONLY with the desktop app closed.
"""
import sqlite3, shutil, sys, os, json, time

SCRIPT_ID = "9e17a3d5-5409-40b1-8ed1-666ca56a2828"
LIVE = os.path.expanduser(
    "~/Library/Application Support/com.proteus.opendraft/opendraft.db")
SNAP = "/tmp/odsnap/Users/kandarpbaghar/Library/Application Support/com.proteus.opendraft/opendraft.db"

def main():
    # 1. Read the good row from the snapshot (read-only / immutable).
    snap = sqlite3.connect(f"file:{SNAP}?immutable=1", uri=True)
    row = snap.execute(
        "SELECT s.title, s.size_bytes, s.updated_at, c.content "
        "FROM scripts s JOIN script_content c ON s.id=c.script_id WHERE s.id=?",
        (SCRIPT_ID,)).fetchone()
    snap.close()
    if not row:
        sys.exit("Snapshot row not found")
    title, size_bytes, updated_at, content = row
    # Sanity: must be the full screenplay, not another blank.
    doc = json.loads(content)
    nodes = len(doc.get("content", []))
    print(f"Snapshot row: title={title!r} size={size_bytes} nodes={nodes} updated_at={updated_at}")
    assert nodes > 100 and "Travel safely" in content, "snapshot content looks wrong/blank"

    # 2. Fresh timestamped backup of the live DB before mutating.
    backup = LIVE + f".bak-{int(time.time())}"
    shutil.copy2(LIVE, backup)
    print(f"Backed up live DB -> {backup}")

    # 3. Show what we're replacing, then restore.
    live = sqlite3.connect(LIVE)
    before = live.execute(
        "SELECT LENGTH(content) FROM script_content WHERE script_id=?",
        (SCRIPT_ID,)).fetchone()[0]
    print(f"Live content length BEFORE: {before}")

    live.execute("UPDATE script_content SET content=? WHERE script_id=?",
                 (content, SCRIPT_ID))
    live.execute("UPDATE scripts SET size_bytes=?, updated_at=? WHERE id=?",
                 (size_bytes, updated_at, SCRIPT_ID))
    live.commit()

    after = live.execute(
        "SELECT LENGTH(content) FROM script_content WHERE script_id=?",
        (SCRIPT_ID,)).fetchone()[0]
    chk = live.execute(
        "SELECT content LIKE '%Travel safely%', content LIKE '%12 YEARS A SLAVE%' "
        "FROM script_content WHERE script_id=?", (SCRIPT_ID,)).fetchone()
    live.close()
    print(f"Live content length AFTER:  {after}")
    print(f"Verify (has 'Travel safely', has title): {chk}")
    print("RESTORE OK" if after == len(content) and all(chk) else "RESTORE MISMATCH")

if __name__ == "__main__":
    main()
