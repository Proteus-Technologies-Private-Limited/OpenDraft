"""Fetch Open Graph / HTML metadata for a URL to generate link previews."""

import html
import re
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_TIMEOUT = 5  # seconds
_MAX_BYTES = 256_000  # only read first ~256 KB of the page
_UA = "Mozilla/5.0 (compatible; OpenDraft/1.0; +https://opendraft.dev)"


class LinkPreviewRequest(BaseModel):
    url: str


class LinkPreviewResponse(BaseModel):
    url: str
    title: str
    description: str
    image: str
    site_name: str


def _meta(body: str, prop: str) -> str:
    """Extract a meta tag value by property or name."""
    # property="og:..."
    m = re.search(
        rf'<meta[^>]+(?:property|name)\s*=\s*["\']?{re.escape(prop)}["\']?[^>]+content\s*=\s*["\']([^"\']*)["\']',
        body,
        re.IGNORECASE,
    )
    if m:
        return html.unescape(m.group(1)).strip()
    # content comes before property (reversed order)
    m = re.search(
        rf'<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]+(?:property|name)\s*=\s*["\']?{re.escape(prop)}["\']?',
        body,
        re.IGNORECASE,
    )
    if m:
        return html.unescape(m.group(1)).strip()
    return ""


def _title(body: str) -> str:
    m = re.search(r"<title[^>]*>([^<]+)</title>", body, re.IGNORECASE)
    return html.unescape(m.group(1)).strip() if m else ""


@router.post("/preview", response_model=LinkPreviewResponse)
async def fetch_link_preview(body: LinkPreviewRequest):
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    try:
        req = Request(url, headers={"User-Agent": _UA})
        with urlopen(req, timeout=_TIMEOUT) as resp:  # noqa: S310
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                raise HTTPException(status_code=422, detail="URL is not an HTML page")
            raw = resp.read(_MAX_BYTES)
    except (URLError, OSError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch URL: {exc}") from exc

    # Detect encoding
    charset = "utf-8"
    ct = content_type.lower()
    if "charset=" in ct:
        charset = ct.split("charset=")[-1].split(";")[0].strip()
    try:
        page = raw.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        page = raw.decode("utf-8", errors="replace")

    og_title = _meta(page, "og:title") or _title(page)
    og_desc = _meta(page, "og:description") or _meta(page, "description")
    og_image = _meta(page, "og:image")
    og_site = _meta(page, "og:site_name")

    # Resolve relative image URLs
    if og_image and not og_image.startswith(("http://", "https://", "//")):
        from urllib.parse import urljoin
        og_image = urljoin(url, og_image)

    return LinkPreviewResponse(
        url=url,
        title=og_title[:300],
        description=og_desc[:500],
        image=og_image,
        site_name=og_site[:100],
    )
