"""
OpenDraft Plugin System

Provides registration points for backend plugins to add API routers
and lifecycle hooks. Plugins register themselves before the app starts.

Usage (from a plugin):
    from app.plugins import register_router, register_hook
    register_router("my-plugin", my_router)
    register_hook("script:after_save", my_callback)
"""

from typing import Callable, Any
from fastapi import APIRouter


# ── Router registration ──

_plugin_routers: list[tuple[str, APIRouter, list[str]]] = []


def register_router(
    name: str,
    router: APIRouter,
    prefix: str | None = None,
    tags: list[str] | None = None,
) -> None:
    """Register a plugin API router.

    Args:
        name: Plugin identifier (used as default prefix: /api/ext/{name})
        router: FastAPI APIRouter instance
        prefix: Optional custom URL prefix (default: /api/ext/{name})
        tags: Optional OpenAPI tags (default: [name])
    """
    _plugin_routers.append((
        prefix or f"/api/ext/{name}",
        router,
        tags or [name],
    ))


def get_plugin_routers() -> list[tuple[str, APIRouter, list[str]]]:
    """Return all registered plugin routers for mounting on the app."""
    return _plugin_routers


# ── Hook system ──

_hooks: dict[str, list[Callable[..., Any]]] = {}


def register_hook(event: str, callback: Callable[..., Any]) -> None:
    """Register a callback for a lifecycle event.

    Built-in events:
        app:startup       — app is starting
        app:shutdown      — app is shutting down
        script:before_save — before a script is saved (project_id, script_id, content)
        script:after_save  — after a script is saved (project_id, script_id, content)
        project:created   — after a project is created (project)
        project:deleted   — after a project is deleted (project_id)
    """
    _hooks.setdefault(event, []).append(callback)


async def run_hooks(event: str, **kwargs: Any) -> None:
    """Execute all callbacks registered for an event. Exceptions are logged
    but do not propagate — use this for side-effect hooks (audit logging,
    cache invalidation, etc.)."""
    for callback in _hooks.get(event, []):
        try:
            result = callback(**kwargs)
            # Support async callbacks
            if hasattr(result, "__await__"):
                await result
        except Exception as exc:
            import logging
            logging.getLogger("plugins").error(
                "Hook %s callback failed: %s", event, exc
            )


async def run_gate_hooks(event: str, **kwargs: Any) -> None:
    """Execute gate callbacks for an event — exceptions PROPAGATE.

    Use this for hooks that may block a request (e.g. quota checks, access
    control). A callback raises HTTPException to reject the request; the
    exception bubbles up through the endpoint unchanged.
    """
    for callback in _hooks.get(event, []):
        result = callback(**kwargs)
        if hasattr(result, "__await__"):
            await result  # type: ignore[arg-type]


def get_registered_plugins() -> list[str]:
    """Return names of registered plugin routers."""
    return [name for name, _, _ in _plugin_routers]
