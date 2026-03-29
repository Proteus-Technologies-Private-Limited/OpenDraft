from pydantic import BaseModel


class ScriptCreate(BaseModel):
    title: str
    content: dict | None = None
    format: str = "json"


class ScriptUpdate(BaseModel):
    title: str | None = None
    content: dict | None = None
    color: str | None = None
    pinned: bool | None = None
    sort_order: int | None = None


class ScriptMeta(BaseModel):
    id: str
    title: str
    author: str
    format: str
    created_at: str
    updated_at: str
    page_count: int = 0
    size_bytes: int = 0
    color: str = ""
    pinned: bool = False
    sort_order: int = 0


class ScriptResponse(BaseModel):
    meta: ScriptMeta
    content: dict | None = None
