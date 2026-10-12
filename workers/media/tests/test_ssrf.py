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


def test_host_allow_list_blocks_lookalikes() -> None:
    assert host_allowed("www.youtube.com")
    assert host_allowed("VM.TikTok.com.")
    assert not host_allowed("evilyoutube.com")
    assert not host_allowed("youtube.com.evil.example")


@pytest.mark.parametrize(
    "url",
    [
        "ftp://www.youtube.com/x",
        "https://user:pw@www.youtube.com/x",
        "https://www.youtube.com:8443/x",
        "https://example.com/x",
        "http://127.0.0.1/x",
    ],
)
def test_assert_url_safe_rejects(url: str) -> None:
    with pytest.raises(PermissionError):
        assert_url_safe(url, public)


def test_allowed_host_resolving_to_private_ip_is_blocked() -> None:
    with pytest.raises(PermissionError, match="non-public"):
        assert_url_safe("https://www.youtube.com/x", lambda _h: ["10.0.0.7"])


def client_for(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes[str(request.url)]

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_follows_short_link_to_final_url() -> None:
    client = client_for(
        {
            "https://vm.tiktok.com/ZMabc/": httpx.Response(301, headers={"location": "https://www.tiktok.com/@u/video/123"}),
            "https://www.tiktok.com/@u/video/123": httpx.Response(200),
        }
    )
    assert resolve_redirects("https://vm.tiktok.com/ZMabc/", client=client, resolver=public) == (
        "https://www.tiktok.com/@u/video/123"
    )


def test_blocks_redirect_to_internal_host() -> None:
    client = client_for(
        {"https://vm.tiktok.com/ZMabc/": httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})}
    )
    with pytest.raises(PermissionError):
        resolve_redirects("https://vm.tiktok.com/ZMabc/", client=client, resolver=public)


def test_blocks_redirect_loops() -> None:
    client = client_for({"https://fb.watch/a/": httpx.Response(302, headers={"location": "https://fb.watch/a/"})})
    with pytest.raises(PermissionError, match="too many"):
        resolve_redirects("https://fb.watch/a/", client=client, resolver=public)
