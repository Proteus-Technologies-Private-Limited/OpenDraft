from fastapi import APIRouter, HTTPException

from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectList
from app.schemas.script import ScriptCreate, ScriptUpdate, ScriptMeta, ScriptResponse
from app.services import project_service, script_service

router = APIRouter()


# ── Project endpoints ──────────────────────────────────────────────────────────

@router.post("/", response_model=ProjectResponse)
async def create_project(body: ProjectCreate):
    try:
        data = project_service.create_project(body.name)
        return data
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/", response_model=ProjectList)
async def list_projects():
    projects = project_service.list_projects()
    return {"projects": projects}


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    try:
        return project_service.get_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, body: ProjectUpdate):
    try:
        props = body.properties.model_dump() if body.properties else None
        return project_service.update_project(project_id, body.name, props)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    try:
        project_service.delete_project(project_id)
        return {"message": f"Project '{project_id}' deleted"}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Script endpoints (nested under project) ───────────────────────────────────

@router.post("/{project_id}/scripts/", response_model=ScriptResponse)
async def create_script(project_id: str, body: ScriptCreate):
    try:
        return script_service.create_script(
            project_id, body.title, body.content, body.format
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{project_id}/scripts/", response_model=list[ScriptMeta])
async def list_scripts(project_id: str):
    try:
        return script_service.list_scripts(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{project_id}/scripts/{script_id}", response_model=ScriptResponse)
async def get_script(project_id: str, script_id: str):
    try:
        return script_service.get_script(project_id, script_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{project_id}/scripts/{script_id}", response_model=ScriptResponse)
async def update_script(project_id: str, script_id: str, body: ScriptUpdate):
    try:
        return script_service.update_script(
            project_id, script_id, body.title, body.content
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}/scripts/{script_id}")
async def delete_script(project_id: str, script_id: str):
    try:
        script_service.delete_script(project_id, script_id)
        return {"message": f"Script '{script_id}' deleted"}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
