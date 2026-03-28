from pydantic import BaseModel


class CheckinRequest(BaseModel):
    message: str


class VersionInfo(BaseModel):
    hash: str
    short_hash: str
    message: str
    date: str
    author: str | None = None


class VersionCommitResponse(BaseModel):
    hash: str | None = None
    short_hash: str | None = None
    message: str
    date: str | None = None


class DiffResponse(BaseModel):
    diff: str
    from_hash: str
    to_hash: str
