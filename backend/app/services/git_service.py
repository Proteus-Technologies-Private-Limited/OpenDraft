"""Git-based version control service for OpenDraft projects.

Uses dulwich (pure Python) instead of GitPython to avoid requiring the
system `git` binary — critical for macOS App Sandbox compliance.
"""

import logging
import time
from pathlib import Path

from dulwich.repo import Repo
from dulwich.objects import Blob, Tree
from dulwich import porcelain
from dulwich.patch import write_tree_diff

logger = logging.getLogger(__name__)

DEFAULT_AUTHOR = b"OpenDraft <opendraft@local>"


def init_repo(project_path: Path) -> None:
    """Initialize a git repo in the project directory if one doesn't exist.

    Creates an initial commit with all existing files.
    """
    if (project_path / ".git").exists():
        return

    porcelain.init(str(project_path))

    # Stage all files that exist (skip .git internals)
    files = [
        str(f.relative_to(project_path))
        for f in project_path.rglob("*")
        if f.is_file() and ".git" not in f.parts
    ]
    if files:
        porcelain.add(str(project_path), files)
        porcelain.commit(
            str(project_path),
            message=b"Initial project setup",
            author=DEFAULT_AUTHOR,
            committer=DEFAULT_AUTHOR,
        )
        logger.info("Initialized git repo at %s with initial commit", project_path)
    else:
        logger.info("Initialized empty git repo at %s", project_path)


def commit(project_path: Path, message: str) -> dict:
    """Stage all changes and create a commit.

    Returns commit info or a message if nothing to commit.
    """
    repo_path = str(project_path)
    repo = Repo(repo_path)

    # Stage all files (add new/modified)
    files = [
        str(f.relative_to(project_path))
        for f in project_path.rglob("*")
        if f.is_file() and ".git" not in f.parts
    ]
    if files:
        porcelain.add(repo_path, files)

    # Handle deletions: remove index entries for files that no longer exist
    index = repo.open_index()
    to_remove = []
    for entry_path in list(index):
        full_path = project_path / entry_path.decode()
        if not full_path.exists():
            to_remove.append(entry_path)
    for path in to_remove:
        del index[path]
    if to_remove:
        index.write()

    # Check if there are actual changes compared to HEAD
    try:
        head = repo.head()
        head_commit = repo[head]
        index = repo.open_index()
        index_tree_id = index.commit(repo.object_store)
        if index_tree_id == head_commit.tree:
            return {"message": "No changes to commit"}
    except KeyError:
        # No HEAD yet — first commit, proceed
        logger.warning("Git repo at %s has no HEAD yet; creating initial commit", project_path)

    commit_id = porcelain.commit(
        repo_path,
        message=message.encode("utf-8"),
        author=DEFAULT_AUTHOR,
        committer=DEFAULT_AUTHOR,
    )
    commit_hex = commit_id.decode("ascii") if isinstance(commit_id, bytes) else str(commit_id)
    return {
        "hash": commit_hex,
        "short_hash": commit_hex[:7],
        "message": message,
        "date": _timestamp_to_iso(int(time.time())),
    }


def _tree_contains_path(repo, tree, path_parts: list[str]) -> bool:
    """Return True iff ``path_parts`` resolves to a blob in ``tree``."""
    current = tree
    for part in path_parts[:-1]:
        found = None
        for item in current.items():
            if item.path.decode() == part:
                found = repo[item.sha]
                break
        if found is None or not isinstance(found, Tree):
            return False
        current = found
    leaf = path_parts[-1]
    for item in current.items():
        if item.path.decode() == leaf:
            return isinstance(repo[item.sha], Blob)
    return False


def get_log(project_path: Path, limit: int = 50, script_id: str | None = None) -> list[dict]:
    """Return the commit log (most recent first).

    If ``script_id`` is given, only commits whose tree contains
    ``scripts/<script_id>.json`` are returned. ``limit`` bounds the number of
    commits walked, not the number returned — if a script is newer than the
    limit, older commits that lack it will still be correctly skipped.
    """
    repo = Repo(str(project_path))

    try:
        head = repo.head()
    except KeyError:
        logger.warning("Git repo at %s has no HEAD; returning empty log", project_path)
        return []

    filter_parts: list[str] | None = None
    if script_id:
        filter_parts = ["scripts", f"{script_id}.json"]

    result = []
    walker = repo.get_walker(include=[head], max_entries=limit)
    for entry in walker:
        c = entry.commit
        if filter_parts is not None:
            tree = repo[c.tree]
            if not _tree_contains_path(repo, tree, filter_parts):
                continue
        commit_hex = c.id.decode("ascii") if isinstance(c.id, bytes) else str(c.id)
        result.append({
            "hash": commit_hex,
            "short_hash": commit_hex[:7],
            "message": c.message.decode("utf-8", errors="replace").strip(),
            "date": _timestamp_to_iso(c.commit_time),
            "author": c.author.decode("utf-8", errors="replace"),
        })
    return result


def get_diff(project_path: Path, from_hash: str, to_hash: str) -> str:
    """Return the unified diff between two commits."""
    import io

    repo = Repo(str(project_path))
    from_commit = repo[from_hash.encode()]
    to_commit = repo[to_hash.encode()]

    buf = io.BytesIO()
    write_tree_diff(buf, repo.object_store, from_commit.tree, to_commit.tree)
    return buf.getvalue().decode("utf-8", errors="replace")


def get_file_at_version(project_path: Path, commit_hash: str, file_path: str) -> str:
    """Return the content of a file at a specific commit."""
    repo = Repo(str(project_path))
    c = repo[commit_hash.encode()]
    tree = repo[c.tree]

    # Walk the tree to find the file
    parts = file_path.split("/")
    current = tree
    for part in parts[:-1]:
        for item in current.items():
            if item.path.decode() == part:
                current = repo[item.sha]
                break
        else:
            raise FileNotFoundError(f"Path component '{part}' not found")

    for item in current.items():
        if item.path.decode() == parts[-1]:
            blob = repo[item.sha]
            return blob.data.decode("utf-8")

    raise FileNotFoundError(f"File '{file_path}' not found at commit {commit_hash[:7]}")


def restore_version(project_path: Path, commit_hash: str) -> dict:
    """Restore files from a past commit, preserving any files added since.

    Mirrors ``git checkout <hash> -- .`` semantics (not ``git reset --hard``):
    every file present in the target tree is overwritten on disk, but files
    that exist in the working tree and are NOT in the target tree are kept.
    This preserves scripts the user created after the target commit.
    """
    repo = Repo(str(project_path))
    short = commit_hash[:7]
    target_commit = repo[commit_hash.encode()]
    target_tree = repo[target_commit.tree]

    # Overlay: write every file from the target tree on top of the working
    # tree. Files on disk that are NOT in the target tree are left alone.
    _restore_tree(repo, target_tree, project_path)

    # Stage everything on disk (both the overlaid target files and any
    # preserved files).
    files = [
        str(f.relative_to(project_path))
        for f in project_path.rglob("*")
        if f.is_file() and ".git" not in f.parts
    ]
    if files:
        porcelain.add(str(project_path), files)

    message = f"Restored to version {short}"
    commit_id = porcelain.commit(
        str(project_path),
        message=message.encode("utf-8"),
        author=DEFAULT_AUTHOR,
        committer=DEFAULT_AUTHOR,
    )
    commit_hex = commit_id.decode("ascii") if isinstance(commit_id, bytes) else str(commit_id)
    return {
        "hash": commit_hex,
        "short_hash": commit_hex[:7],
        "message": message,
        "date": _timestamp_to_iso(int(time.time())),
    }


def _restore_tree(repo, tree, base_path: Path) -> None:
    """Recursively restore files from a dulwich tree object."""
    for item in tree.items():
        name = item.path.decode()
        obj = repo[item.sha]
        target = base_path / name
        if isinstance(obj, Blob):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(obj.data)
        elif isinstance(obj, Tree):
            target.mkdir(parents=True, exist_ok=True)
            _restore_tree(repo, obj, target)


def _timestamp_to_iso(timestamp: int) -> str:
    """Convert a Unix timestamp to ISO 8601 string."""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
