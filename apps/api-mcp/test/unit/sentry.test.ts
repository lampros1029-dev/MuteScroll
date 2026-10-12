import { describe, expect, it } from "vitest";

import { reportErrorClass } from "../../src/observe/sentry.js";

const DSN = "https://abc123@o0.ingest.sentry.io/1";

function captureFetch(): { fetchImpl: typeof fetch; bodies: string[]; urls: string[] } {
  const bodies: string[] = [];
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    urls.push(String(input));
    bodies.push(String(init?.body ?? ""));
    return new Response(null, { status: 200 });
  };
  return { fetchImpl, bodies, urls };
}

describe("reportErrorClass", () => {
  it("does nothing when SENTRY_DSN is unset", () => {
    const captured = captureFetch();
    reportErrorClass(new Error("secret"), {}, captured.fetchImpl);
    expect(captured.urls).toEqual([]);
  });

  it("does nothing when SENTRY_DSN is not a DSN", () => {
    const captured = captureFetch();
    reportErrorClass(new Error("secret"), { SENTRY_DSN: "not-a-dsn" }, captured.fetchImpl);
    expect(captured.urls).toEqual([]);
  });

  it("sends the error class name only", async () => {
    const captured = captureFetch();
    const error = new TypeError("postgres://user:secret@db/ms");
    reportErrorClass(error, { SENTRY_DSN: DSN }, captured.fetchImpl);
    await Promise.resolve();
    expect(captured.urls).toEqual(["https://o0.ingest.sentry.io/api/1/envelope/"]);
    const body = captured.bodies[0] ?? "";
    expect(body).toContain("TypeError");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("postgres");
  });
});
