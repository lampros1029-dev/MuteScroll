import { createHash } from "node:crypto";

/** Inline script for the upload form. Its hash goes into the CSP, so no external asset is loaded. */
const SCRIPT = `(function () {
  var input = document.getElementById("file");
  var button = document.getElementById("send");
  var out = document.getElementById("out");
  button.addEventListener("click", function () {
    var file = input.files && input.files[0];
    if (!file) { out.textContent = "Choose a file first."; return; }
    button.disabled = true;
    out.textContent = "Uploading...";
    fetch(window.location.pathname, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
      body: file
    }).then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) { out.textContent = data.message || "Upload failed. Try again."; })
      .catch(function () { out.textContent = "Upload failed. Check your connection and try again."; })
      .finally(function () { button.disabled = false; });
  });
})();`;

const STYLE = "body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5}";

function scriptHash(): string {
  return `sha256-${createHash("sha256").update(SCRIPT, "utf8").digest("base64")}`;
}

export function uploadPageCsp(): string {
  return [
    "default-src 'none'",
    `script-src '${scriptHash()}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Plain message page for invalid or used links. Messages are constants, never user input. */
export function messagePageHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>
<body><h1>${title}</h1><p>${message}</p></body>
</html>
`;
}

export function uploadPageHtml(maxBytes: number): string {
  const megabytes = Math.round(maxBytes / (1024 * 1024));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upload a video to MuteScroll</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Upload a video</h1>
<p>Choose the file and MuteScroll will transcribe it. Accepted: MP4, MOV, WebM, M4A, MP3, WAV. Maximum size: ${megabytes} MB.</p>
<p><input id="file" type="file" accept=".mp4,.mov,.webm,.m4a,.mp3,.wav,video/*,audio/*"></p>
<p><button id="send" type="button">Upload</button></p>
<p id="out" role="status"></p>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
