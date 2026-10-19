import { afterEach, describe, expect, it } from "vitest";

import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("/.well-known/openai-apps-challenge", () => {
  it("returns the configured token as text", async () => {
    const token = "abcDEF1234567890_-token";
    server = await startTestServer(testConfig({ OPENAI_APPS_CHALLENGE: token }));
    const response = await fetch(`${server.baseUrl}/.well-known/openai-apps-challenge`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(token);
  });

  it("stays 404 when the token is unset", async () => {
    server = await startTestServer(testConfig());
    const response = await fetch(`${server.baseUrl}/.well-known/openai-apps-challenge`);
    expect(response.status).toBe(404);
  });

  it("rejects other methods", async () => {
    server = await startTestServer(testConfig({ OPENAI_APPS_CHALLENGE: "abcDEF1234567890" }));
    const response = await fetch(`${server.baseUrl}/.well-known/openai-apps-challenge`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
