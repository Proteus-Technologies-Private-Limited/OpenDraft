"""Exercise git_service.delete_version on a throwaway project (discussion #183).

Run from the project root:  venv/bin/python test-script/test_delete_version.py
"""

import shutil
import subprocess
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


def store_contains(p: Path, needle: bytes) -> bool:
    """True if any object in .git, loose or packed, holds ``needle``."""
    from dulwich.repo import Repo

    store = Repo(str(p)).object_store
    return any(needle in store[sha].as_raw_string() for sha in store)


def reflog_contains(p: Path, needle: bytes) -> bool:
    logs = p / ".git" / "logs"
    return logs.is_dir() and any(needle in f.read_bytes() for f in logs.rglob("*") if f.is_file())


def git_fsck(p: Path) -> str | None:
    """Output of the real ``git fsck`` (strict check of every object), or None without git."""
    if not shutil.which("git"):
        return None
    r = subprocess.run(
        ["git", "fsck", "--full", "--unreachable", "--no-reflogs", "--no-dangling"],
        cwd=p, capture_output=True, text=True,
    )
    return f"rc={r.returncode}\n{r.stdout}{r.stderr}".strip()


def erasure_checks() -> int:
    """Deleted versions must be gone from .git, not just from the history list."""
    failures = 0

    def check(cond: bool, label: str) -> None:
        nonlocal failures
        print(("PASS " if cond else "FAIL ") + label)
        if not cond:
            failures += 1

    secret_text = b"SECRET-SCENE-TEXT"
    secret_label = "SECRET-VERSION-LABEL"

    # 1. Deleting a middle version erases its text and label, keeps the rest.
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        write(p, "a.json", "v0")
        git_service.init_repo(p)
        write(p, "a.json", secret_text.decode())
        git_service.commit(p, secret_label)
        write(p, "a.json", "v2")
        git_service.commit(p, "draft 2")
        check(store_contains(p, secret_text), "erase: secret is stored before delete")

        target = [c for c in git_service.get_log(p) if c["message"] == secret_label][0]
        git_service.delete_version(p, target["hash"])
        check(not store_contains(p, secret_text), "erase: deleted version's text gone from .git")
        check(not store_contains(p, secret_label.encode()), "erase: deleted version's label gone from objects")
        check(not reflog_contains(p, secret_label.encode()), "erase: deleted version's label gone from reflog")
        check([snapshot(p, c["hash"]) for c in git_service.get_log(p)] == ["v2", "v0"], "erase: remaining versions readable")
        fsck = git_fsck(p)
        if fsck is not None:
            check(fsck == "rc=0", f"erase: git fsck clean, nothing unreachable ({fsck!r})")

    # 2. Text shared with a surviving version is kept (it still belongs to that version).
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        write(p, "a.json", "v0")
        git_service.init_repo(p)
        write(p, "a.json", "shared")
        git_service.commit(p, "first")
        write(p, "a.json", "other")
        git_service.commit(p, "second")
        write(p, "a.json", "shared")
        git_service.commit(p, "third")
        first = [c for c in git_service.get_log(p) if c["message"] == "first"][0]
        git_service.delete_version(p, first["hash"])
        check([snapshot(p, c["hash"]) for c in git_service.get_log(p)] == ["shared", "other", "v0"], "erase: shared content survives")

    # 3. Deleting the only version, then checking in unchanged files: the index
    #    still points at those blobs and they must not have been erased.
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        write(p, "a.json", "only")
        git_service.init_repo(p)
        only = git_service.get_log(p)[0]
        git_service.delete_version(p, only["hash"])
        check(git_service.get_log(p) == [], "erase: history empty after deleting only version")
        res = git_service.commit(p, "again")
        log = git_service.get_log(p)
        check("hash" in res and len(log) == 1 and snapshot(p, log[0]["hash"]) == "only",
              "erase: check-in of unchanged files after deleting everything")
        fsck = git_fsck(p)
        if fsck is not None:
            check(fsck == "rc=0", f"erase: git fsck clean after re-check-in ({fsck!r})")

    # 4. Objects packed by an outside `git gc` are erased too.
    if shutil.which("git"):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            write(p, "a.json", "v0")
            git_service.init_repo(p)
            write(p, "a.json", secret_text.decode())
            git_service.commit(p, secret_label)
            write(p, "a.json", "v2")
            git_service.commit(p, "draft 2")
            subprocess.run(["git", "gc", "--quiet"], cwd=p, check=True)
            check(not any((p / ".git" / "objects").glob("??/*")), "erase(packed): everything packed before delete")
            target = [c for c in git_service.get_log(p) if c["message"] == secret_label][0]
            git_service.delete_version(p, target["hash"])
            check(not store_contains(p, secret_text), "erase(packed): text gone from packs")
            check([snapshot(p, c["hash"]) for c in git_service.get_log(p)] == ["v2", "v0"], "erase(packed): remaining versions readable")
            fsck = git_fsck(p)
            check(fsck == "rc=0", f"erase(packed): git fsck clean ({fsck!r})")
    else:
        print("SKIP erase(packed): git binary not installed")

    return failures


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

    failures += erasure_checks()

    print("\nALL PASSED" if not failures else f"\n{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
