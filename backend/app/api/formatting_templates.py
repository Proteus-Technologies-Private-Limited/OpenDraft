"""API router for formatting template CRUD."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import formatting_template_service

router = APIRouter()


class TemplateCreate(BaseModel):
    id: str | None = None
    name: str = "Untitled Template"
    description: str = ""
    mode: str = "enforce"
    rules: dict = {}
    createdAt: str | None = None
    updatedAt: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    mode: str | None = None
    rules: dict | None = None


@router.get("/")
async def list_templates():
    return formatting_template_service.list_templates()


@router.post("/")
async def create_template(body: TemplateCreate):
    return formatting_template_service.create_template(body.model_dump())


@router.get("/{template_id}")
async def get_template(template_id: str):
    try:
        return formatting_template_service.get_template(template_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{template_id}")
async def update_template(template_id: str, body: TemplateUpdate):
    try:
        data = {k: v for k, v in body.model_dump().items() if v is not None}
        return formatting_template_service.update_template(template_id, data)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{template_id}")
async def delete_template(template_id: str):
    formatting_template_service.delete_template(template_id)
    return {"message": "Template deleted"}
