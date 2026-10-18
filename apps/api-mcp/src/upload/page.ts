import { createHash } from "node:crypto";

/** Inline script for the upload form. Its hash goes into the CSP, so no external asset is loaded. */
const SCRIPT = `(function () {
  var input = document.getElementById("file");
  var button = document.getElementById("send");
  var out = document.getElementById("out");
  var name = document.getElementById("filename");
  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    name.textContent = file ? file.name : "No file chosen";
  });
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

/** Same geometry as apps/web/src/app/icon.svg. Middle bar is the accent. */
const MARK = `<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect width="64" height="64" rx="14" fill="#1d1b16"/>
  <rect x="12" y="16" width="40" height="6" rx="3" fill="#f6f2ea"/>
  <rect x="12" y="29" width="26" height="6" rx="3" fill="#ff8a5c"/>
  <rect x="12" y="42" width="34" height="6" rx="3" fill="#f6f2ea" opacity="0.55"/>
</svg>`;

const STYLE = `:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#14130f;color:#f6f2ea}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:1.0625rem;line-height:1.6;-webkit-font-smoothing:antialiased}
main{max-width:32rem;margin:0 auto;padding:2.75rem 1.25rem 3.5rem}
.brand{display:flex;align-items:center;gap:.85rem;margin:0 0 2.25rem;color:#f6f2ea;font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"Times New Roman",serif;font-size:1.75rem;letter-spacing:-.01em}
.mark{width:64px;height:64px;flex:none}
h1{margin:0 0 .75rem;color:#f6f2ea;font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"Times New Roman",serif;font-size:clamp(2rem,6vw,2.75rem);font-weight:400;line-height:1.12;letter-spacing:-.015em}
.lede{margin:0 0 .75rem}
.rules{margin:0 0 1.5rem;color:#bdb7a8}
.panel{display:flex;flex-direction:column;gap:.85rem;padding:1rem;background:#1c1a15;border:1px solid #3a372f;border-radius:12px}
.picker{position:relative;display:flex;align-items:center;gap:.75rem;min-height:48px;padding:.35rem .75rem .35rem .35rem;background:#14130f;border:1px solid #3a372f;border-radius:8px}
.file-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
.choose{display:inline-flex;align-items:center;justify-content:center;flex:none;min-height:44px;padding:0 1rem;border:1.5px solid #f6f2ea;border-radius:8px;color:#f6f2ea;font-weight:600;cursor:pointer}
.picker:focus-within .choose{outline:2px solid #ff8a5c;outline-offset:2px}
.filename{min-width:0;overflow:hidden;color:#bdb7a8;text-overflow:ellipsis;white-space:nowrap}
#send{width:100%;min-height:48px;padding:0 1.25rem;border:0;border-radius:8px;background:#ff8a5c;color:#1d1b16;font:inherit;font-size:1.0625rem;font-weight:600;cursor:pointer}
#send:hover{background:#ff9a70}
#send:focus-visible{outline:2px solid #f6f2ea;outline-offset:3px}
#send:disabled{opacity:.55;cursor:not-allowed}
#out{min-height:1.5rem;margin:1rem 0 0}`;

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

function pageDocument(title: string, body: string, script = ""): string {
  const scriptTag = script ? `<script>${script}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header class="brand">${MARK}<span>MuteScroll</span></header>
${body}
</main>
${scriptTag}
</body>
</html>
`;
}

/** Plain message page for invalid or used links. Messages are constants, never user input. */
export function messagePageHtml(title: string, message: string): string {
  return pageDocument(title, `<h1>${title}</h1><p>${message}</p>`);
}

export function uploadPageHtml(maxBytes: number): string {
  const megabytes = Math.round(maxBytes / (1024 * 1024));
  return pageDocument(
    "One-time upload — MuteScroll",
    `<h1>One-time upload</h1>
<p class="lede">This is the one-time upload. Choose a file and MuteScroll will transcribe it.</p>
<p id="rules" class="rules">Accepted: MP4, MOV, WebM, M4A, MP3, WAV. Maximum size: ${megabytes} MB.</p>
<div class="panel">
<div class="picker">
<input id="file" class="file-input" type="file" accept=".mp4,.mov,.webm,.m4a,.mp3,.wav,video/*,audio/*" aria-describedby="rules">
<label class="choose" for="file">Choose a file</label>
<span id="filename" class="filename">No file chosen</span>
</div>
<button id="send" type="button">Upload</button>
</div>
<p id="out" role="status"></p>`,
    SCRIPT,
  );
}
