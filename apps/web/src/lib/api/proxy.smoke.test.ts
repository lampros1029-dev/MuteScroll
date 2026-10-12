import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET, POST } from "../../app/api/[...path]/route";

describe("api proxy", () => {
  let base = "";
  let seen: { headers: IncomingMessage["headers"]; url: string | undefined; method: string | undefined; body: Buffer } | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen = { headers: req.headers, url: req.url, method: req.method, body: Buffer.concat(chunks) };
      const mode = new URL(req.url ?? "/", "http://upstream").searchParams.get("mode");
      if (mode === "cookies") {
        res.writeHead(200, [
          "content-type",
          "text/plain",
          "set-cookie",
          "ms_session=abc; HttpOnly; Path=/",
          "set-cookie",
          "ms_csrf=xyz; Path=/",
          "connection",
          "close",
          "transfer-encoding",
          "chunked",
        ]);
        res.end("ok");
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.concat(chunks));
    });
  });

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
    process.env.API_BASE_URL = base;
  });

  afterAll(async () => {
    server.close();
    await once(server, "close");
    delete process.env.API_BASE_URL;
  });

  function call(method: "GET" | "POST", path: string, init: RequestInit & { path: string[] }): Promise<Response> {
    const request = new Request(`${base}${path}`, init);
    const context = { params: Promise.resolve({ path: init.path }) };
    return method === "GET" ? GET(request, context) : POST(request, context);
  }

  it("sends only the right-most forwarded address and streams the body", async () => {
    const payload = Buffer.alloc(64 * 1024, 7);
    const response = await call("POST", "/v1/uploads?x=1", {
      method: "POST",
      path: ["v1", "uploads"],
      headers: {
        "content-type": "video/mp4",
        "content-length": String(payload.length),
        "x-filename": "clip.mp4",
        "x-forwarded-for": "6.6.6.6, 198.51.100.7",
        connection: "close",
        "transfer-encoding": "chunked",
      },
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(payload);
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("/v1/uploads?x=1");
    expect(seen?.headers["x-forwarded-for"]).toBe("198.51.100.7");
    expect(seen?.headers["x-filename"]).toBe("clip.mp4");
    expect(seen?.headers["content-length"]).toBe(String(payload.length));
    // The client's Connection and Transfer-Encoding are hop-by-hop and must not be forwarded.
    // Node may set its own Connection for this hop.
    expect(seen?.headers.connection).not.toBe("close");
    expect(seen?.headers["transfer-encoding"]).toBeUndefined();
    expect(seen?.headers.host).toBe(new URL(base).host);
  });

  it("omits X-Forwarded-For when the incoming request has none", async () => {
    const response = await call("GET", "/v1/transcriptions/job-1", {
      method: "GET",
      path: ["v1", "transcriptions", "job-1"],
    });
    expect(response.status).toBe(200);
    expect(seen?.headers["x-forwarded-for"]).toBeUndefined();
    expect(seen?.url).toBe("/v1/transcriptions/job-1");
  });

  it("forwards every Set-Cookie and drops hop-by-hop response headers", async () => {
    const response = await call("GET", "/v1/auth/login?mode=cookies", {
      method: "GET",
      path: ["v1", "auth", "login"],
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "ms_session=abc; HttpOnly; Path=/",
      "ms_csrf=xyz; Path=/",
    ]);
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(await response.text()).toBe("ok");
  });
});
