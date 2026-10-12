"""SSRF guard for the media worker (PRD section 17).

TypeScript validates the URL shape and host allow-list (`@mutescroll/shared`). The worker
must additionally check where a hostname actually *resolves* before connecting, and again
for every redirect hop, because DNS can point an allowed-looking name at an internal address.

Known limit: checking DNS and then connecting leaves a small rebinding window. Production
workers must also run with no route to private ranges (network policy) as defence in depth.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 5
ALLOWED_DOMAINS: tuple[str, ...] = (
    "youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "fb.watch", "fb.com",
)  # fmt: skip

# Media CDNs a licensed vendor may hand back (PRD 22.2). Kept separate from ALLOWED_DOMAINS so a
# user-submitted URL can never point at a CDN host directly.
MEDIA_CDN_DOMAINS: tuple[str, ...] = (
    "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu",
    "byteoversea.com", "ibytedtos.com", "muscdn.com", "cdninstagram.com", "fbcdn.net",
)  # fmt: skip

Resolver = Callable[[str], list[str]]


def is_public_ip(address: str) -> bool:
    """Return True only for globally routable addresses."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def assert_all_public(addresses: list[str]) -> None:
    """Raise if the resolved set is empty or contains any non-public address."""
    if not addresses:
        raise PermissionError("hostname did not resolve")
    for address in addresses:
        if not is_public_ip(address):
            raise PermissionError(f"blocked non-public address: {address}")


def _in_domains(host: str, domains: tuple[str, ...]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith(f".{d}") for d in domains)


def host_allowed(host: str) -> bool:
    return _in_domains(host, ALLOWED_DOMAINS)


def media_host_allowed(host: str) -> bool:
    return _in_domains(host, MEDIA_CDN_DOMAINS)


def system_resolver(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)})
    except socket.gaierror as exc:
        raise PermissionError(f"could not resolve {host}") from exc


def assert_url_safe(
    url: str,
    resolver: Resolver = system_resolver,
    *,
    host_check: Callable[[str], bool] = host_allowed,
) -> None:
    """Scheme, allow-listed host, no credentials, and every resolved address is public."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise PermissionError("only http(s) URLs are allowed")
    if parts.username or parts.password:
        raise PermissionError("credentials in URL are not allowed")
    if parts.port not in (None, 80, 443):
        raise PermissionError("custom ports are not allowed")
    host = parts.hostname or ""
    if not host_check(host):
        raise PermissionError(f"host not allowed: {host}")
    assert_all_public(resolver(host))


def resolve_redirects(
    url: str,
    *,
    client: httpx.Client | None = None,
    resolver: Resolver = system_resolver,
) -> str:
    """Follow short-link redirects manually, re-validating every hop. Returns the final URL."""
    owns_client = client is None
    http = client or httpx.Client(timeout=15.0, follow_redirects=False)
    try:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            assert_url_safe(current, resolver)
            response = http.get(current, headers={"user-agent": "MuteScrollBot/1.0 (+https://mutescroll.xyz)"})
            if response.status_code not in (301, 302, 303, 307, 308):
                return current
            location = response.headers.get("location")
            if not location:
                return current
            current = urljoin(current, location)
        raise PermissionError("too many redirects")
    finally:
        if owns_client:
            http.close()
