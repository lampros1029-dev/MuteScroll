import httpx
import pytest

from mutescroll_media.ssrf import (
    assert_all_public,
    assert_url_safe,
    host_allowed,
    is_public_ip,
    resolve_redirects,
)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "224.0.0.1",
        "not-an-ip",
    ],
)
def test_blocks_non_public(address: str) -> None:
    assert is_public_ip(address) is False


@pytest.mark.parametrize("address", ["8.8.8.8", "142.250.74.14", "2606:4700:4700::1111"])
def test_allows_public(address: str) -> None:
    assert is_public_ip(address) is True


def test_assert_all_public_rejects_mixed_and_empty() -> None:
    with pytest.raises(PermissionError):
        assert_all_public([])
    with pytest.raises(PermissionError):
        assert_all_public(["8.8.8.8", "10.0.0.1"])
    assert_all_public(["8.8.8.8", "1.1.1.1"])


def public(_host: str) -> list[str]:
    return ["8.8.8.8"]


def test_host_allowed_accepts_public_names_and_blocks_local_ones() -> None:
    assert host_allowed("example.com")
    assert host_allowed("WWW.Example.com.")
    assert not host_allowed("localhost")
    assert not host_allowed("printer.local")
    assert not host_allowed("foo.internal")
    assert not host_allowed("127.0.0.1")
    assert not host_allowed("intranet")


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/x",
        "https://user:pw@example.com/x",
        "https://example.com:8443/x",
        "file:///etc/passwd",
        "http://127.0.0.1/x",
        "http://localhost/x",
    ],
)
def test_assert_url_safe_rejects(url: str) -> None:
    with pytest.raises(PermissionError):
        assert_url_safe(url, public)


def test_public_link_with_public_addresses_is_allowed() -> None:
    assert_url_safe("https://example.com/video", public)


def test_allowed_host_resolving_to_private_ip_is_blocked() -> None:
    with pytest.raises(PermissionError, match="non-public"):
        assert_url_safe("https://example.com/x", lambda _h: ["10.0.0.7"])


def client_for(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes[str(request.url)]

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_follows_short_link_to_final_url() -> None:
    client = client_for(
        {
            "https://go.example/abc/": httpx.Response(301, headers={"location": "https://www.example.com/video/123"}),
            "https://www.example.com/video/123": httpx.Response(200),
        }
    )
    assert resolve_redirects("https://go.example/abc/", client=client, resolver=public) == (
        "https://www.example.com/video/123"
    )


def test_blocks_redirect_to_internal_host() -> None:
    client = client_for(
        {"https://go.example/abc/": httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})}
    )
    with pytest.raises(PermissionError):
        resolve_redirects("https://go.example/abc/", client=client, resolver=public)


def test_blocks_redirect_loops() -> None:
    client = client_for({"https://go.example/a/": httpx.Response(302, headers={"location": "https://go.example/a/"})})
    with pytest.raises(PermissionError, match="too many"):
        resolve_redirects("https://go.example/a/", client=client, resolver=public)
