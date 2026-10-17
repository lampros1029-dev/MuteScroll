import { request as httpRequest } from "node:http";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function probe(baseUrl: string, method: string): Promise<{ status: number; body: string; allow: string | string[] | undefined }> {
  const url = new URL("/healthz", baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            allow: res.headers.allow,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Node's HTTP client discards HEAD bodies, so read the bytes on the wire. */
function raw(baseUrl: string, method: string): Promise<string> {
  const url = new URL("/healthz", baseUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(`${method} /healthz HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

describe("/healthz", () => {
  it("answers HEAD with the same ok payload as GET", async () => {
    server = await startTestServer(testConfig());
    const get = await probe(server.baseUrl, "GET");
    const head = await raw(server.baseUrl, "HEAD");
    expect(get).toMatchObject({ status: 200, body: '{"status":"ok"}' });
    expect(head).toContain("HTTP/1.1 200 OK");
    expect(head).toContain('{"status":"ok"}');
    const post = await probe(server.baseUrl, "POST");
    expect(post.status).toBe(405);
    expect(post.allow).toBe("GET, HEAD");
  });
});
