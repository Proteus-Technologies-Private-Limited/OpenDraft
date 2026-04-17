"""Location Database API — per-project persistent location metadata."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import location_service, script_service

router = APIRouter()
logger = logging.getLogger(__name__)


class LocationCreate(BaseModel):
    name: str
    fullName: str = ""
    type: str = "interior"
    address: str = ""
    notes: str = ""
    contact: str = ""
    availability: str = ""
    tags: list[str] = []
    imageAssetIds: list[str] = []
    aliases: list[str] = []


class LocationUpdate(BaseModel):
    name: str | None = None
    fullName: str | None = None
    type: str | None = None
    address: str | None = None
    notes: str | None = None
    contact: str | None = None
    availability: str | None = None
    tags: list[str] | None = None
    imageAssetIds: list[str] | None = None
    aliases: list[str] | None = None


@router.get("/{project_id}/locations/")
async def list_locations(project_id: str):
    try:
        return {"locations": location_service.list_locations(project_id)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{project_id}/locations/")
async def create_location(project_id: str, body: LocationCreate):
    try:
        return location_service.create_location(project_id, body.model_dump())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/locations/{loc_id}")
async def get_location(project_id: str, loc_id: str):
    try:
        return location_service.get_location(project_id, loc_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{project_id}/locations/{loc_id}")
async def update_location(project_id: str, loc_id: str, body: LocationUpdate):
    try:
        payload = {k: v for k, v in body.model_dump().items() if v is not None}
        return location_service.update_location(project_id, loc_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}/locations/{loc_id}")
async def delete_location(project_id: str, loc_id: str):
    try:
        location_service.delete_location(project_id, loc_id)
        return {"message": "ok"}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{project_id}/locations/discover")
async def discover_locations(project_id: str):
    """Scan every script in the project and auto-create missing locations."""
    try:
        scripts = script_service.list_scripts(project_id)
        contents = []
        for meta in scripts:
            try:
                sc = script_service.get_script(project_id, meta["id"])
                contents.append(sc)
            except FileNotFoundError:
                continue
        return location_service.discover_locations(project_id, contents)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
