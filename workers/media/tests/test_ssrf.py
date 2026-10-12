import pytest

from mutescroll_media.ssrf import assert_all_public, is_public_ip


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
