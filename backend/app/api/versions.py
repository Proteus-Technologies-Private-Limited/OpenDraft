"""Version control API endpoints for OpenDraft projects."""

from fastapi import APIRouter, HTTPException, Query

from app.config import PROJECTS_DIR
from app.schemas.version import (
    CheckinRequest,
    DiffResponse,
    VersionCommitResponse,
    VersionInfo,
)
from app.services import git_service

router = APIRouter()


def _project_path(project_id: str):
    """Resolve and validate project directory path."""
    path = PROJECTS_DIR / project_id
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return path


@router.post("/{project_id}/versions/checkin", response_model=VersionCommitResponse)
async def checkin(project_id: str, body: CheckinRequest):
    """Stage all changes and create a version checkpoint (git commit)."""
    path = _project_path(project_id)

    # Ensure repo is initialized
    git_service.init_repo(path)

    result = git_service.commit(path, body.message)
    return result


@router.get("/{project_id}/versions/", response_model=list[VersionInfo])
async def list_versions(project_id: str, limit: int = Query(50, ge=1, le=500)):
    """List version history for a project."""
    path = _project_path(project_id)

    # Ensure repo is initialized
    git_service.init_repo(path)

    return git_service.get_log(path, limit=limit)


@router.get("/{project_id}/versions/diff", response_model=DiffResponse)
async def get_diff(
    project_id: str,
    from_hash: str = Query(..., description="Starting commit hash"),
    to_hash: str = Query(..., description="Ending commit hash"),
):
    """Get the unified diff between two versions."""
    path = _project_path(project_id)

    try:
        diff_text = git_service.get_diff(path, from_hash, to_hash)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"diff": diff_text, "from_hash": from_hash, "to_hash": to_hash}


@router.get("/{project_id}/versions/{commit_hash}/scripts/{script_id}")
async def get_script_at_version(project_id: str, commit_hash: str, script_id: str):
    """Return script content as it existed at a specific commit."""
    path = _project_path(project_id)

    try:
        content_str = git_service.get_file_at_version(
            path, commit_hash, f"scripts/{script_id}.json"
        )
        meta_str = git_service.get_file_at_version(
            path, commit_hash, f"scripts/{script_id}.meta.json"
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    import json

    return {
        "meta": json.loads(meta_str),
        "content": json.loads(content_str),
    }


@router.post("/{project_id}/versions/restore/{commit_hash}", response_model=VersionCommitResponse)
async def restore_version(project_id: str, commit_hash: str):
    """Restore the project to a specific version (creates a new commit)."""
    path = _project_path(project_id)

    try:
        result = git_service.restore_version(path, commit_hash)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return result
