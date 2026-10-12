/**
 * Proves https://api.mutescroll.xyz/mcp speaks Streamable HTTP.
 * Sends initialize, then tools/list, as separate requests (the server is stateless).
 * Does not call transcribe_video or get_transcription.
 */

const ENDPOINT = "https://api.mutescroll.xyz/mcp";
const CLIENT_PROTOCOL = "2025-11-25";
const TRANSCRIBE_TOOL = "transcribe_video";

const requiredHeaders = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseRpcMessage(body, contentType) {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("empty response body");
  }
  if (contentType?.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const messages = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (data.length === 0) continue;
      messages.push(JSON.parse(data));
    }
    const rpc = messages.find((message) => message.result !== undefined || message.error !== undefined);
    if (rpc === undefined) throw new Error("SSE body had no JSON-RPC result");
    return rpc;
  }
  return JSON.parse(trimmed);
}

async function post(body, extraHeaders = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { ...requiredHeaders, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let message;
  try {
    message = parseRpcMessage(text, response.headers.get("content-type"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable body";
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return { status: response.status, message };
}

const initialize = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: CLIENT_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "mutescroll-mcp-smoke", version: "0.1.0" },
  },
});

const protocolVersion = initialize.message.result?.protocolVersion;
console.log(`initialize status: ${initialize.status}`);
console.log(`protocol version: ${protocolVersion ?? "(missing)"}`);

if (initialize.status !== 200 || typeof protocolVersion !== "string") {
  const rpcError = initialize.message.error?.message;
  fail(rpcError ? `initialize failed: ${rpcError}` : "initialize did not return a protocol version");
} else {
  const listed = await post(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { "mcp-protocol-version": protocolVersion },
  );
  const tools = Array.isArray(listed.message.result?.tools) ? listed.message.result.tools : [];
  const names = tools.map((tool) => tool?.name).filter((name) => typeof name === "string");
  console.log(`tools/list status: ${listed.status}`);
  console.log(`tools: ${names.join(", ") || "(none)"}`);
  if (listed.status !== 200 || listed.message.error) {
    fail(listed.message.error?.message ?? "tools/list failed");
  } else if (!names.includes(TRANSCRIBE_TOOL)) {
    fail(`tools/list did not include ${TRANSCRIBE_TOOL}`);
  }
}
