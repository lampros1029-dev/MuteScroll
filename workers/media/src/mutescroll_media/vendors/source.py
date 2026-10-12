"""MediaSource backed by a licensed vendor, plus a router that picks it per platform (PRD 22.2)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from urllib.parse import urljoin

import httpx

from ..models import VideoMetadata
from ..sources import CaptionResult, MediaSource, RetrievalError, SourceInfo, platform_of
from ..ssrf import MAX_REDIRECTS, Resolver, assert_url_safe, media_host_allowed, system_resolver
from .scrapecreators import ResolvedMedia, ScrapeCreatorsClient

VENDOR_PLATFORMS: frozenset[str] = frozenset({"tiktok", "instagram"})
MAX_MEDIA_BYTES = 300 * 1024**2
_REDIRECTS = (301, 302, 303, 307, 308)


class VendorSource:
    """Resolves via the vendor, then downloads the media from the CDN URL the vendor returned.

    Never returns captions: transcription is always ours, so timestamps and fidelity checks apply.
    """

    def __init__(
        self,
        client: ScrapeCreatorsClient,
        *,
        http: httpx.Client | None = None,
        resolver: Resolver = system_resolver,
    ) -> None:
        self._client = client
        self._http = http or httpx.Client(timeout=60.0, follow_redirects=False)
        self._resolver = resolver
        self._resolved: dict[str, ResolvedMedia] = {}  # one vendor credit per URL per run
        self.credits_used = 0

    def fetch_info(self, url: str) -> SourceInfo:
        platform = platform_of(url)
        if platform not in VENDOR_PLATFORMS:
            raise RetrievalError("unsupported_platform", f"The video vendor does not handle {platform}.")
        resolved = self._resolved.get(url)
        if resolved is None:
            resolved = self._client.resolve(platform, url)
            self._resolved[url] = resolved
            self.credits_used += resolved.credits_charged
        return SourceInfo(
            metadata=VideoMetadata(
                platform=platform,
                title=resolved.title,
                author=resolved.author,
                duration_seconds=resolved.duration_seconds,
                content_type=None,
            )
        )

    def fetch_captions(self, info: SourceInfo, language: str | None, *, automatic: bool) -> CaptionResult | None:
        return None

    def download_audio(self, url: str, workdir: Path) -> Path:
        resolved = self._resolved.get(url)
        if resolved is None:
            self.fetch_info(url)
            resolved = self._resolved[url]
        target = workdir / "source.mp4"
        self._download(resolved.media_url, target)
        return target

    def _download(self, media_url: str, target: Path) -> None:
        current = media_url
        for _ in range(MAX_REDIRECTS + 1):
            try:
                assert_url_safe(current, self._resolver, host_check=media_host_allowed)
            except PermissionError as exc:
                raise RetrievalError("retrieval_failed", "The video service returned an unsafe media link.", str(exc)) from exc
            try:
                with self._http.stream("GET", current) as response:
                    if response.status_code in _REDIRECTS and response.headers.get("location"):
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code in (401, 403, 404, 410):
                        raise RetrievalError("retrieval_failed", "The media link was refused.", f"HTTP {response.status_code}")
                    response.raise_for_status()
                    self._write_capped(response, target)
                    return
            except httpx.HTTPError as exc:
                raise RetrievalError("retrieval_failed", "Could not download the media.", exc.__class__.__name__) from exc
        raise RetrievalError("retrieval_failed", "Too many redirects while downloading the media.")

    @staticmethod
    def _write_capped(response: httpx.Response, target: Path) -> None:
        written = 0
        with target.open("wb") as handle:
            for chunk in response.iter_bytes(65536):
                written += len(chunk)
                if written > MAX_MEDIA_BYTES:
                    handle.close()
                    target.unlink(missing_ok=True)
                    raise RetrievalError("too_long", "This video is too large to process.")
                handle.write(chunk)


class RoutedSource:
    """Vendor for TikTok and Instagram when configured; everything else uses the default source."""

    def __init__(self, default: MediaSource, vendor: MediaSource | None) -> None:
        self._default = default
        self._vendor = vendor

    def _for_platform(self, platform: str) -> MediaSource:
        if self._vendor is not None and platform in VENDOR_PLATFORMS:
            return self._vendor
        return self._default

    def fetch_info(self, url: str) -> SourceInfo:
        return self._for_platform(platform_of(url)).fetch_info(url)

    def fetch_captions(self, info: SourceInfo, language: str | None, *, automatic: bool) -> CaptionResult | None:
        return self._for_platform(info.metadata.platform).fetch_captions(info, language, automatic=automatic)

    def download_audio(self, url: str, workdir: Path) -> Path:
        return self._for_platform(platform_of(url)).download_audio(url, workdir)


def build_source(
    default: MediaSource,
    *,
    scrapecreators_key: str | None,
    client_factory: Callable[[str], ScrapeCreatorsClient] = ScrapeCreatorsClient,
) -> MediaSource:
    """Wire the vendor in only when a key is configured; otherwise behave exactly as before."""
    if not scrapecreators_key:
        return default
    return RoutedSource(default, VendorSource(client_factory(scrapecreators_key)))
