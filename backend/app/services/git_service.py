"""Git-based version control service for OpenDraft projects."""

import logging
from pathlib import Path

import git

logger = logging.getLogger(__name__)


def init_repo(project_path: Path) -> None:
    """Initialize a git repo in the project directory if one doesn't exist.

    Creates an initial commit with all existing files.
    """
    if (project_path / ".git").exists():
        return

    repo = git.Repo.init(project_path)

    # Stage all files that exist (skip .git internals)
    files = [
        str(f.relative_to(project_path))
        for f in project_path.rglob("*")
        if f.is_file() and ".git" not in f.parts
    ]
    if files:
        repo.index.add(files)
        repo.index.commit("Initial project setup")
        logger.info("Initialized git repo at %s with initial commit", project_path)
    else:
        logger.info("Initialized empty git repo at %s", project_path)


def commit(project_path: Path, message: str) -> dict:
    """Stage all changes and create a commit.

    Returns commit info or a message if nothing to commit.
    """
    repo = git.Repo(project_path)
    repo.git.add(A=True)

    # Check if there's anything to commit — handle empty repos (no HEAD yet)
    try:
        has_changes = repo.is_dirty(untracked_files=True) or bool(repo.index.diff("HEAD"))
    except (git.exc.GitCommandError, ValueError):
        # No HEAD exists yet — if there are staged files, commit them
        has_changes = len(repo.untracked_files) > 0 or len(repo.index.entries) > 0

    if not has_changes:
        return {"message": "No changes to commit"}

    c = repo.index.commit(message)
    return {
        "hash": str(c),
        "short_hash": str(c)[:7],
        "message": message,
        "date": c.committed_datetime.isoformat(),
    }


def get_log(project_path: Path, limit: int = 50) -> list[dict]:
    """Return the commit log (most recent first)."""
    repo = git.Repo(project_path)

    # Handle repos with no commits yet (no HEAD reference)
    try:
        commits = list(repo.iter_commits(max_count=limit))
    except (git.exc.GitCommandError, ValueError):
        return []

    return [
        {
            "hash": str(c),
            "short_hash": str(c)[:7],
            "message": c.message.strip(),
            "date": c.committed_datetime.isoformat(),
            "author": str(c.author),
        }
        for c in commits
    ]


def get_diff(project_path: Path, from_hash: str, to_hash: str) -> str:
    """Return the unified diff between two commits."""
    repo = git.Repo(project_path)
    return repo.git.diff(from_hash, to_hash)


def get_file_at_version(project_path: Path, commit_hash: str, file_path: str) -> str:
    """Return the content of a file at a specific commit."""
    repo = git.Repo(project_path)
    c = repo.commit(commit_hash)
    blob = c.tree / file_path
    return blob.data_stream.read().decode("utf-8")


def restore_version(project_path: Path, commit_hash: str) -> dict:
    """Restore the working tree to a specific version (creates a new commit)."""
    repo = git.Repo(project_path)
    short = commit_hash[:7]
    repo.git.checkout(commit_hash, "--", ".")
    repo.git.add(A=True)
    new_commit = repo.index.commit(f"Restored to version {short}")
    return {
        "hash": str(new_commit),
        "short_hash": str(new_commit)[:7],
        "message": new_commit.message.strip(),
        "date": new_commit.committed_datetime.isoformat(),
    }
