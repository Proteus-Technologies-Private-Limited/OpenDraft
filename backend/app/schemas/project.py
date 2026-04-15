from pydantic import BaseModel


class SubmissionEntry(BaseModel):
    """A single submission log entry for tracking script submissions."""
    id: str = ""
    date: str = ""
    submitted_to: str = ""
    type: str = ""               # e.g. General Meeting, Submission, Query
    status: str = ""             # e.g. Pending, Read request, Passed, Considering
    notes: str = ""


class ProjectProperties(BaseModel):
    """All editable project metadata fields."""
    genre: str = ""
    logline: str = ""
    synopsis: str = ""
    author: str = ""
    contact: str = ""
    copyright: str = ""
    draft: str = ""
    language: str = ""
    format: str = ""             # e.g. Feature Film, TV Pilot, Short Film
    production_company: str = ""
    director: str = ""
    producer: str = ""
    status: str = ""             # e.g. In Development, Pre-Production, Production
    target_length: str = ""      # e.g. "90-120 min"
    notes: str = ""
    # Registration & Legal
    wga_registration: str = ""
    wga_registration_date: str = ""
    copyright_registration: str = ""
    copyright_year: str = ""
    agent_name: str = ""
    agent_contact: str = ""
    manager_name: str = ""
    manager_contact: str = ""
    submissions: list[SubmissionEntry] = []


class ProjectCreate(BaseModel):
    name: str
    properties: ProjectProperties | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    properties: ProjectProperties | None = None
    color: str | None = None
    pinned: bool | None = None
    sort_order: int | None = None


class ReorderItem(BaseModel):
    id: str
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


class ProjectResponse(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    properties: ProjectProperties = ProjectProperties()
    color: str = ""
    pinned: bool = False
    sort_order: int = 0


class ProjectList(BaseModel):
    projects: list[ProjectResponse]
