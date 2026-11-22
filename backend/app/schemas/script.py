from pydantic import BaseModel, Field


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
    # Opt-in to overwriting a non-empty script with an empty body (intentional
    # clear). Defaults False so an accidental empty save is rejected.
    allow_empty_body: bool = False


class OfflineScriptUpdate(BaseModel):
    content: dict
    expected_content_revision: str = Field(pattern=r"^[a-f0-9]{64}$")


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
    preview: str = ""


class ScriptResponse(BaseModel):
    meta: ScriptMeta
    content: dict | None = None
    content_revision: str | None = None
