import unicodedata
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from starlette.responses import Response

from app.services import asset_service

router = APIRouter()


def content_disposition(disposition: str, filename: str) -> str:
    """Build a Content-Disposition header that survives a non-ASCII filename.

    HTTP header values are latin-1, and a filename interpolated straight into
    one is a 500 waiting for the first file that is not pure ASCII. It does not
    take an unusual name: every macOS screenshot carries U+202F (narrow no-break
    space) before the AM/PM, so ``Screenshot ... 12.25.22 PM.png`` crashed this
    endpoint, and the storyboard frame it was dropped into came back empty.

    RFC 6266 has the answer, and both halves are given because they serve
    different readers: ``filename=`` is an ASCII-folded fallback for anything
    old, ``filename*=`` carries the real name UTF-8 percent-encoded.
    """
    # NFKD splits an accented letter into its base plus a combining mark and
    # folds U+202F to a plain space; dropping the marks then leaves "resume",
    # not "re_sume_". Anything still unrepresentable (CJK, emoji) becomes '_'
    # rather than raising or vanishing.
    folded = unicodedata.normalize("NFKD", filename)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    ascii_name = folded.encode("ascii", "replace").decode("ascii").replace("?", "_")
    # A quote or a backslash would close the quoted-string early, and a newline
    # would end the header itself — injection shapes, not just broken names.
    ascii_name = "".join("_" if c in '"\\' or ord(c) < 0x20 or ord(c) == 0x7F else c for c in ascii_name)
    ascii_name = ascii_name.strip() or "download"
    encoded = quote(filename, safe="")
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


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
        fname = entry.get("original_name") or asset_id
        response.headers["Content-Disposition"] = content_disposition(disposition, fname)
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
