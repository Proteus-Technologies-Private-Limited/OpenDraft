from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import collab_service

router = APIRouter()


class InviteRequest(BaseModel):
    project_id: str
    script_id: str
    collaborator_name: str
    role: str = "editor"
    expires_in_hours: float = 1


class InviteResponse(BaseModel):
    token: str
    project_id: str
    script_id: str
    collaborator_name: str
    role: str
    created_at: str
    expires_at: str


class SessionResponse(BaseModel):
    token: str
    project_id: str
    script_id: str
    collaborator_name: str
    role: str = "editor"
    created_at: str
    expires_at: str = ""
    active: bool


@router.post("/invite", response_model=InviteResponse)
async def create_invite(req: InviteRequest):
    """Generate a collaboration invite link for a person."""
    session = collab_service.create_session(
        project_id=req.project_id,
        script_id=req.script_id,
        collaborator_name=req.collaborator_name,
        role=req.role,
        expires_in_hours=req.expires_in_hours,
    )
    return InviteResponse(**session)


@router.get("/session/{token}", response_model=SessionResponse)
async def validate_session(token: str):
    """Validate a collab token and return session info."""
    session = collab_service.validate_session(token)
    if not session:
        raise HTTPException(status_code=404, detail="Invalid or expired invite")
    return SessionResponse(**session)


@router.get("/sessions/{project_id}/{script_id}", response_model=list[SessionResponse])
async def list_sessions(project_id: str, script_id: str):
    """List active collab sessions for a script."""
    sessions = collab_service.list_sessions(project_id, script_id)
    return [SessionResponse(**s) for s in sessions]


@router.delete("/session/{token}")
async def revoke_invite(token: str):
    """Revoke a collab invite."""
    if collab_service.revoke_session(token):
        return {"message": "Session revoked"}
    raise HTTPException(status_code=404, detail="Session not found")


@router.delete("/sessions/{project_id}/{script_id}")
async def revoke_all(project_id: str, script_id: str):
    """Revoke all collab sessions for a script (end collaboration)."""
    count = collab_service.revoke_all_sessions(project_id, script_id)
    return {"message": f"Revoked {count} session(s)"}
