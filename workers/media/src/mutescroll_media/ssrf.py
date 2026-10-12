"""SSRF guard for the media worker (PRD section 17).

TypeScript validates the URL shape and host allow-list (`@mutescroll/shared`). The worker
must additionally check where a hostname actually *resolves* before connecting, and again
for every redirect hop, because DNS can point an allowed-looking name at an internal address.
"""

from __future__ import annotations

import ipaddress

MAX_REDIRECTS = 5


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
