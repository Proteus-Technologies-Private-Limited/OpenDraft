from fastapi import APIRouter, Depends, HTTPException

from app.config import DEFAULT_PROJECT
from app.dependencies import require_verified_user
from app.plugins import run_gate_hooks
from app.schemas.script import ScriptCreate, ScriptUpdate, ScriptMeta, ScriptResponse
from app.services import project_service, script_service
from app.services.auth_service import AuthUser
from app.services.quota_service import QUOTA_CHECK_CREATE_SCRIPT

router = APIRouter()


def _default_project_id() -> str:
    """Ensure the default project exists and return its ID."""
    data = project_service.ensure_default_project(DEFAULT_PROJECT)
    return data["id"]


@router.get("/", response_model=list[ScriptMeta])
async def list_scripts():
    project_id = _default_project_id()
    return script_service.list_scripts(project_id)


@router.post("/", response_model=ScriptResponse)
async def create_script(
    body: ScriptCreate,
    user: AuthUser = Depends(require_verified_user),
):
    await run_gate_hooks(QUOTA_CHECK_CREATE_SCRIPT, user=user)
    project_id = _default_project_id()
    return script_service.create_script(
        project_id, body.title, body.content, body.format
    )


@router.get("/{script_id}", response_model=ScriptResponse)
async def get_script(script_id: str):
    project_id = _default_project_id()
    try:
        return script_service.get_script(project_id, script_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{script_id}", response_model=ScriptResponse)
async def update_script(script_id: str, body: ScriptUpdate):
    project_id = _default_project_id()
    try:
        return script_service.update_script(
            project_id, script_id, body.title, body.content
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{script_id}")
async def delete_script(script_id: str):
    project_id = _default_project_id()
    try:
        script_service.delete_script(project_id, script_id)
        return {"message": f"Script '{script_id}' deleted"}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
