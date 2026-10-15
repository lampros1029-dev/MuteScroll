"""SSRF guard for the media worker.

TypeScript validates the URL shape (`@mutescroll/shared`). The worker checks that the
hostname is a public DNS name and that every resolved address is a public IP, including
on each redirect hop. A name can still point at an internal address.

Known limit: resolve-then-connect leaves a DNS rebinding window. That window is accepted
for this launch; no extra network policy is added here.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 5
_FETCH_HEADERS = {"user-agent": "MuteScrollBot/1.0 (+https://mutescroll.xyz)"}

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


def host_allowed(host: str) -> bool:
    """True for a public DNS name. IP literals and local names are refused before DNS."""
    host = host.lower().rstrip(".")
    if not host or host.startswith("[") or ":" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    if host.replace(".", "").isdigit():
        return False
    if "." not in host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return False
    return True


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
    """Scheme, public DNS name, no credentials, and every resolved address is public."""
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
    """Follow redirects manually, re-validating every hop. Returns the final URL. The body is not read."""
    owns_client = client is None
    http = client or httpx.Client(timeout=15.0, follow_redirects=False)
    try:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            assert_url_safe(current, resolver)
            with http.stream("GET", current, headers=_FETCH_HEADERS) as response:
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
