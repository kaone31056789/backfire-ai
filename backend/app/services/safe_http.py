"""Outbound HTTP with SSRF protection.

Only HTTPS requests to an explicit allow-list of public research/AI APIs are
permitted. Redirects are followed manually and re-validated; private, loopback
and link-local resolutions are rejected; responses are size-capped.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from ..core.config import get_settings

ALLOWED_HOSTS = {
    "api.openalex.org",
    "api.crossref.org",
    "power.larc.nasa.gov",
    "api.gbif.org",
    "api.anthropic.com",
    "api.openai.com",
    "ollama.com",
}
MAX_BYTES = 8 * 1024 * 1024


class BlockedRequest(Exception):
    pass


def _check_url(url: str) -> None:
    p = urlparse(url)
    local = urlparse(get_settings().ollama_local_url)
    if (p.scheme, p.hostname, p.port) == (local.scheme, local.hostname, local.port) and p.path.startswith("/api/"):
        return  # explicitly configured local Ollama server (admin setting, never user-supplied)
    if p.scheme != "https":
        raise BlockedRequest("Only HTTPS is allowed")
    host = (p.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise BlockedRequest(f"Host not in allow-list: {host}")
    if p.username or p.password:
        raise BlockedRequest("Credentials in URL are not allowed")
    try:
        infos = socket.getaddrinfo(host, p.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise BlockedRequest(f"DNS resolution failed for {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise BlockedRequest(f"{host} resolves to a non-public address")


def request(method: str, url: str, *, params=None, json=None, headers=None, timeout: float | None = None,
            max_redirects: int = 3) -> httpx.Response:
    s = get_settings()
    hdrs = {"User-Agent": f"BACKFIRE-AI/1.0 (mailto:{s.contact_email})", **(headers or {})}
    with httpx.Client(timeout=timeout or s.evidence_timeout_s, follow_redirects=False) as client:
        for _ in range(max_redirects + 1):
            _check_url(url)
            with client.stream(method, url, params=params, json=json, headers=hdrs) as resp:
                if resp.is_redirect:
                    url = str(resp.next_request.url) if resp.next_request else resp.headers.get("location", "")
                    params = None
                    continue
                body = b""
                for chunk in resp.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        raise BlockedRequest("Response too large")
                # body is already decoded: drop encoding/length headers so it is not decoded twice
                hdrs_out = {k: v for k, v in resp.headers.items() if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")}
                return httpx.Response(resp.status_code, headers=hdrs_out, content=body, request=resp.request)
    raise BlockedRequest("Too many redirects")


def get_json(url: str, params=None, headers=None, timeout: float | None = None) -> dict:
    r = request("GET", url, params=params, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.json()
