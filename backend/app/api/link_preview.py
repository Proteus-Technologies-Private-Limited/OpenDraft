"""Fetch Open Graph / HTML metadata for a URL to generate link previews."""

import html
import ipaddress
import logging
import re
import socket
from urllib.error import URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

_TIMEOUT = 5  # seconds
_MAX_BYTES = 256_000  # only read first ~256 KB of the page
_UA = "Mozilla/5.0 (compatible; OpenDraft/1.0; +https://opendraft.dev)"


def _validate_url(url: str) -> tuple[str, str]:
    """Validate that a URL does not point to a private/reserved IP address.

    Returns (safe_url, original_host) where safe_url has the hostname replaced
    with the resolved IP to prevent DNS rebinding attacks.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")

    try:
        addr_infos = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname")

    for family, _type, _proto, _canonname, sockaddr in addr_infos:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_link_local:
            raise HTTPException(status_code=400, detail="URL points to a restricted address")

    # Use the first resolved IP to prevent DNS rebinding
    resolved_ip = addr_infos[0][4][0]
    ip_obj = ipaddress.ip_address(resolved_ip)
    if isinstance(ip_obj, ipaddress.IPv6Address):
        netloc = f"[{resolved_ip}]"
    else:
        netloc = resolved_ip
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"

    safe_url = urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    return safe_url, hostname


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

    safe_url, original_host = _validate_url(url)

    try:
        req = Request(safe_url, headers={"User-Agent": _UA, "Host": original_host})
        with urlopen(req, timeout=_TIMEOUT) as resp:  # noqa: S310
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                raise HTTPException(status_code=422, detail="URL is not an HTML page")
            raw = resp.read(_MAX_BYTES)
    except HTTPException:
        raise
    except (URLError, OSError, ValueError) as exc:
        logger.warning("Link preview fetch failed for URL: %s", exc)
        raise HTTPException(status_code=502, detail="Could not fetch the requested URL") from exc

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
