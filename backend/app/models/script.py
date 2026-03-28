from sqlalchemy import Column, String, Text, DateTime, Integer, Boolean, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timezone
import uuid

Base = declarative_base()


class Script(Base):
    __tablename__ = "scripts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False, default="Untitled Screenplay")
    author = Column(String(255), default="")
    content_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    page_count = Column(Integer, default=1)
    revision_color = Column(String(50), default="White")
    revision_mode = Column(Boolean, default=False)


class Scene(Base):
    __tablename__ = "scenes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id = Column(String, nullable=False)
    scene_number = Column(Integer, nullable=True)
    heading = Column(String(500), nullable=False)
    synopsis = Column(Text, default="")
    color = Column(String(50), default="#4a9eff")
    position = Column(Integer, default=0)


class Character(Base):
    __tablename__ = "characters"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id = Column(String, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
