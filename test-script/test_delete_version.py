"""Exercise git_service.delete_version on a throwaway project (discussion #183).

Run from the project root:  venv/bin/python test-script/test_delete_version.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services import git_service  # noqa: E402


def write(p: Path, name: str, text: str) -> None:
    (p / "scripts").mkdir(exist_ok=True)
    (p / "scripts" / name).write_text(text)


def snapshot(p: Path, h: str) -> str:
    return git_service.get_file_at_version(p, h, "scripts/a.json")


def main() -> int:
    failures = 0

    def check(cond: bool, label: str) -> None:
        nonlocal failures
        print(("PASS " if cond else "FAIL ") + label)
        if not cond:
            failures += 1

    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        write(p, "a.json", "v0")
        git_service.init_repo(p)
        for i in (1, 2, 3):
            write(p, "a.json", f"v{i}")
            git_service.commit(p, f"draft {i}")

        log = git_service.get_log(p)
        check([c["message"] for c in log] == ["draft 3", "draft 2", "draft 1", "Initial project setup"], "four versions")

        # Middle version: later ones keep their content and messages.
        git_service.delete_version(p, log[1]["hash"])
        log2 = git_service.get_log(p)
        check([c["message"] for c in log2] == ["draft 3", "draft 1", "Initial project setup"], "middle deleted")
        check([snapshot(p, c["hash"]) for c in log2] == ["v3", "v1", "v0"], "snapshots intact after middle delete")
        check(log2[0]["date"] == log[0]["date"], "dates preserved")
        check((p / "scripts" / "a.json").read_text() == "v3", "working file untouched")

        # Newest (HEAD).
        git_service.delete_version(p, log2[0]["hash"])
        log3 = git_service.get_log(p)
        check([snapshot(p, c["hash"]) for c in log3] == ["v1", "v0"], "head deleted")
        check((p / "scripts" / "a.json").read_text() == "v3", "working file still untouched")

        # Oldest (root): the next one becomes the root.
        git_service.delete_version(p, log3[-1]["hash"])
        log4 = git_service.get_log(p)
        check([snapshot(p, c["hash"]) for c in log4] == ["v1"], "root deleted")

        # Unknown hash.
        try:
            git_service.delete_version(p, "0" * 40)
            check(False, "unknown hash refused")
        except FileNotFoundError:
            check(True, "unknown hash refused")

        # The last one, then a fresh check-in still works.
        git_service.delete_version(p, log4[0]["hash"])
        check(git_service.get_log(p) == [], "history empty")
        write(p, "a.json", "v4")
        res = git_service.commit(p, "after wipe")
        check("hash" in res and len(git_service.get_log(p)) == 1, "check-in after deleting everything")

    print("\nALL PASSED" if not failures else f"\n{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
