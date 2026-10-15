import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { FakeWorker } from "../helpers/fake-worker.js";
import { startTestServer, testConfig } from "../helpers/harness.js";
import { api, bearer, createKey, GOOD_PASSWORD, sessionHeaders, signUp } from "../helpers/rest.js";
import { STORE_MODES } from "../helpers/postgres.js";
import { serverStarter } from "../helpers/suite.js";

describe.each(STORE_MODES)("REST accounts on $name stores", (mode) => {
  const start = serverStarter(mode);

  it("signs up, sets an HttpOnly session and a readable CSRF cookie, and reports the free plan", async () => {
    const server = await start();
    const result = await api(server, "/v1/auth/signup", {
      method: "POST",
      json: { email: "  Ada@Example.test ", password: GOOD_PASSWORD },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ email: "ada@example.test", plan: "free", credits: { remaining: 20 } });
    expect(result.body.credits.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(result.text).not.toMatch(/scrypt|password_hash/);

    const cookies = result.headers.getSetCookie();
    const session = cookies.find((line) => line.startsWith("ms_session="));
    const csrf = cookies.find((line) => line.startsWith("ms_csrf="));
    expect(session).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    expect(session).not.toMatch(/Secure/);
    expect(csrf).toMatch(/; SameSite=Lax/);
    expect(csrf).not.toMatch(/HttpOnly/);
  });

  it("refuses weak passwords, bad addresses and a second account on the same address", async () => {
    const server = await start();
    const weak = await api(server, "/v1/auth/signup", { method: "POST", json: { email: `w-${randomUUID()}@example.test`, password: "short" } });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("invalid_request");

    const badEmail = await api(server, "/v1/auth/signup", { method: "POST", json: { email: "nope", password: GOOD_PASSWORD } });
    expect(badEmail.status).toBe(400);

    const email = `dup-${randomUUID()}@example.test`;
    expect((await api(server, "/v1/auth/signup", { method: "POST", json: { email, password: GOOD_PASSWORD } })).status).toBe(201);
    const again = await api(server, "/v1/auth/signup", { method: "POST", json: { email: email.toUpperCase(), password: GOOD_PASSWORD } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("email_taken");
  });

  it("logs in with the right password and answers a wrong password and an unknown address identically", async () => {
    const server = await start();
    const account = await signUp(server);
    const wrong = await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: "not the password" } });
    const unknown = await api(server, "/v1/auth/login", { method: "POST", json: { email: `ghost-${randomUUID()}@example.test`, password: GOOD_PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("invalid_credentials");

    const right = await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: GOOD_PASSWORD } });
    expect(right.status).toBe(200);
    expect(right.headers.getSetCookie().some((line) => line.startsWith("ms_session="))).toBe(true);
  });

  it("logs out only with the CSRF echo, and the old session stops working", async () => {
    const server = await start();
    const account = await signUp(server);
    const refused = await api(server, "/v1/auth/logout", { method: "POST", headers: { cookie: account.cookie } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("csrf_failed");

    const out = await api(server, "/v1/auth/logout", { method: "POST", headers: sessionHeaders(account) });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().every((line) => line.includes("Max-Age=0"))).toBe(true);

    const me = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
    expect(me.status).toBe(401);
  });

  it("requires the CSRF header on cookie-authenticated writes but not on reads", async () => {
    const server = await start();
    const account = await signUp(server);
    const noCsrf = await api(server, "/v1/api-keys", { method: "POST", headers: { cookie: account.cookie } });
    expect(noCsrf.status).toBe(403);
    const wrongCsrf = await api(server, "/v1/api-keys", { method: "POST", headers: { cookie: account.cookie, "x-csrf-token": "nope" } });
    expect(wrongCsrf.status).toBe(403);
    const read = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
    expect(read.status).toBe(200);
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");
    await server.ctx.stores.users.setPlan(user.id, "team");
    expect((await api(server, "/v1/api-keys", { method: "POST", headers: sessionHeaders(account) })).status).toBe(201);
  });

  it("lists keys without their secret, authenticates with a key, and revokes it at once", async () => {
    const server = await start();
    const account = await signUp(server);
    const key = await createKey(server, account);
    expect(key.key).toMatch(/^msk_/);

    const listed = await api(server, "/v1/api-keys", { headers: { cookie: account.cookie } });
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ id: key.id, prefix: key.key.slice(0, 12), last_used_at: null });
    expect(listed.text).not.toContain(key.key);

    const viaKey = await api(server, "/v1/me", { headers: bearer(key.key) });
    expect(viaKey.status).toBe(200);
    expect(viaKey.body.email).toBe(account.email);

    const revoked = await api(server, `/v1/api-keys/${key.id}`, { method: "DELETE", headers: sessionHeaders(account) });
    expect(revoked.status).toBe(204);
    expect((await api(server, "/v1/me", { headers: bearer(key.key) })).status).toBe(401);
  });

  it("does not let an API key mint or delete API keys", async () => {
    const server = await start();
    const account = await signUp(server);
    const key = await createKey(server, account);
    const minted = await api(server, "/v1/api-keys", { method: "POST", headers: bearer(key.key) });
    expect(minted.status).toBe(403);
    expect(minted.body.error.code).toBe("forbidden");
    const deleted = await api(server, `/v1/api-keys/${key.id}`, { method: "DELETE", headers: bearer(key.key) });
    expect(deleted.status).toBe(403);
  });

  it("deletes only the caller's own key, and answers 404 for anyone else's", async () => {
    const server = await start();
    const owner = await signUp(server);
    const other = await signUp(server);
    const key = await createKey(server, owner);
    const wrong = await api(server, `/v1/api-keys/${key.id}`, { method: "DELETE", headers: sessionHeaders(other) });
    expect(wrong.status).toBe(404);
    expect((await api(server, "/v1/me", { headers: bearer(key.key) })).status).toBe(200);
  });

  it("refuses a presented key that is malformed or unknown instead of acting anonymously", async () => {
    const server = await start();
    expect((await api(server, "/v1/me", { headers: bearer("msk_nope") })).status).toBe(401);
    const transcribe = await api(server, "/v1/transcriptions", {
      method: "POST",
      headers: bearer(`msk_${"A".repeat(43)}`),
      json: { url: "https://example.com/video/aaaaaaaaaaa" },
    });
    expect(transcribe.status).toBe(401);
    expect(transcribe.body.error.code).toBe("unauthorized");
  });

  it("keeps account-only endpoints closed to anonymous callers", async () => {
    const server = await start();
    expect((await api(server, "/v1/me")).status).toBe(401);
    expect((await api(server, "/v1/library")).status).toBe(401);
    expect((await api(server, "/v1/api-keys")).status).toBe(401);
  });

  it("refuses non-JSON and malformed bodies with the documented codes", async () => {
    const server = await start();
    const wrongType = await api(server, "/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ email: "a@example.test", password: GOOD_PASSWORD }),
    });
    expect(wrongType.status).toBe(415);
    expect(wrongType.body.error.code).toBe("unsupported_media_type");

    const broken = await api(server, "/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("invalid_request");

    const unknownField = await api(server, "/v1/auth/signup", {
      method: "POST",
      json: { email: `x-${randomUUID()}@example.test`, password: GOOD_PASSWORD, plan: "team" },
    });
    expect(unknownField.status).toBe(400);
  });

  it("refuses JSON bodies over the configured limit with 413", async () => {
    const server = await start({ REST_JSON_MAX_BODY_BYTES: "1024" });
    const result = await api(server, "/v1/auth/login", { method: "POST", json: { email: "a@example.test", password: "x".repeat(4000) } });
    expect(result.status).toBe(413);
    expect(result.body.error.code).toBe("too_large");
  });

  it("limits sign-ups per client address", async () => {
    const server = await start({ AUTH_SIGNUPS_PER_IP_PER_HOUR: "2" });
    for (let i = 0; i < 2; i += 1) {
      const ok = await api(server, "/v1/auth/signup", { method: "POST", json: { email: `limit-${i}-${randomUUID()}@example.test`, password: GOOD_PASSWORD } });
      expect(ok.status).toBe(201);
    }
    const limited = await api(server, "/v1/auth/signup", { method: "POST", json: { email: `limit-x-${randomUUID()}@example.test`, password: GOOD_PASSWORD } });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("limits log-in attempts per client address", async () => {
    const server = await start({ AUTH_LOGINS_PER_IP_PER_MINUTE: "2" });
    const account = await signUp(server);
    for (let i = 0; i < 2; i += 1) {
      expect((await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: "wrong password" } })).status).toBe(401);
    }
    expect((await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: GOOD_PASSWORD } })).status).toBe(429);
  });

  it("re-issues the session cookie once the session has slid forward, and not on every request", async () => {
    let clock = Date.now();
    const config = testConfig({});
    const fixture = await mode.open(config.jobTtl, () => clock);
    const server = await startTestServer(config, { stores: fixture.stores, worker: new FakeWorker(), now: () => clock });
    try {
      const account = await signUp(server);
      clock += 11 * 60 * 1000;
      const slid = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      expect(slid.status).toBe(200);
      expect(slid.headers.getSetCookie().some((line) => line.startsWith("ms_session=") && line.includes("Max-Age=2592000"))).toBe(true);
      clock += 1000;
      const quiet = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      expect(quiet.status).toBe(200);
      expect(quiet.headers.getSetCookie()).toEqual([]);
    } finally {
      await server.close();
      await fixture.close();
    }
  });

  it("lists the public plans with no checkout links", async () => {
    const server = await start();
    const plans = await api(server, "/v1/plans");
    expect(plans.status).toBe(200);
    expect(plans.body.plans.map((plan: { id: string }) => plan.id)).toEqual(["free", "creator", "pro", "team"]);
    expect(plans.body.plans[0]).toMatchObject({ id: "free", monthly_credits: 20, max_video_minutes: 10, price_usd_monthly: 0 });
    expect(plans.text).not.toMatch(/checkout|paddle|stripe/i);
  });

  it("answers unknown paths and wrong methods in the REST error shape", async () => {
    const server = await start();
    const missing = await api(server, "/v1/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
    const wrongMethod = await api(server, "/v1/me", { method: "PUT", json: {} });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, DELETE");
    expect(wrongMethod.body.error.code).toBe("method_not_allowed");
  });

  it("returns the library listing newest first, scoped to the caller", async () => {
    const server = await start();
    const account = await signUp(server);
    const other = await signUp(server);
    const empty = await api(server, "/v1/library", { headers: { cookie: other.cookie } });
    expect(empty.body.items).toEqual([]);
    const badLimit = await api(server, "/v1/library?limit=0", { headers: { cookie: account.cookie } });
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe("invalid_request");
  });

  it("lets only the Team plan create or use API keys, and keeps the key when the plan changes", async () => {
    const server = await start();
    const account = await signUp(server);
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");

    const free = await api(server, "/v1/api-keys", { method: "POST", headers: sessionHeaders(account) });
    expect(free.status).toBe(403);
    expect(free.body.error.code).toBe("plan_required");

    await server.ctx.stores.users.setPlan(user.id, "pro");
    expect((await api(server, "/v1/api-keys", { method: "POST", headers: sessionHeaders(account) })).status).toBe(403);

    await server.ctx.stores.users.setPlan(user.id, "team");
    const created = await api(server, "/v1/api-keys", { method: "POST", headers: sessionHeaders(account) });
    expect(created.status).toBe(201);
    const key = created.body.key as string;
    expect((await api(server, "/v1/me", { headers: bearer(key) })).status).toBe(200);

    await server.ctx.stores.users.setPlan(user.id, "free");
    const refused = await api(server, "/v1/me", { headers: bearer(key) });
    const unknown = await api(server, "/v1/me", { headers: bearer(`msk_${"b".repeat(43)}`) });
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual(unknown.body);
    const listed = await api(server, "/v1/api-keys", { headers: { cookie: account.cookie } });
    expect(listed.body.items).toHaveLength(1);

    const mcp = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);

    await server.ctx.stores.users.setPlan(user.id, "team");
    expect((await api(server, "/v1/me", { headers: bearer(key) })).status).toBe(200);
  });
});
