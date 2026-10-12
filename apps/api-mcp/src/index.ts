import { createServer } from "node:http";
import { PLATFORMS } from "@mutescroll/shared";

/**
 * M0 skeleton. The remote MCP endpoint (`/mcp`, tools `transcribe_video` and
 * `get_transcription`) lands in M2; see PRD §8 and §22.
 */
const port = Number(process.env["PORT"] ?? 8080);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", platforms: PLATFORMS }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, () => {
  console.log(`mutescroll api-mcp listening on :${port}`);
});
