from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from starlette.responses import Response

from app.services import asset_service

router = APIRouter()


@router.post("/{project_id}/assets/upload")
async def upload_asset(
    project_id: str,
    file: UploadFile = File(...),
    tags: str = Form(""),
):
    """Upload an asset file to a project. Tags is a comma-separated string."""
    try:
        content = await file.read()
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        entry = await asset_service.upload_asset(
            project_id,
            content,
            file.filename or "unnamed",
            tag_list,
        )
        return entry
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/assets/")
async def list_assets(project_id: str):
    """List all assets in a project."""
    try:
        assets = asset_service.list_assets(project_id)
        return {"assets": assets}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{project_id}/assets/{asset_id}")
async def download_asset(
    project_id: str,
    asset_id: str,
    disposition: str = Query("attachment", pattern="^(attachment|inline)$"),
):
    """Download or view an asset file. Use ?disposition=inline to display in browser."""
    try:
        entry = asset_service.get_asset_entry(project_id, asset_id)
        file_path = asset_service.get_asset_path(project_id, asset_id)
        response = FileResponse(
            path=str(file_path),
            media_type=entry["mime_type"],
        )
        fname = entry["original_name"]
        response.headers["Content-Disposition"] = f'{disposition}; filename="{fname}"'
        return response
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{project_id}/assets/{asset_id}/tags")
async def update_asset_tags(project_id: str, asset_id: str, tags: list[str]):
    """Update tags for an asset."""
    try:
        entry = asset_service.update_tags(project_id, asset_id, tags)
        return entry
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}/assets/{asset_id}")
async def delete_asset(project_id: str, asset_id: str):
    """Delete an asset."""
    try:
        asset_service.delete_asset(project_id, asset_id)
        return {"message": f"Asset '{asset_id}' deleted"}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
