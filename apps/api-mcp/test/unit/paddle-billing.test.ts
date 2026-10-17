import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MemoryUserStore } from "../../src/accounts/memory-stores.js";
import { applyDueDowngrades, applySubscriptionChange } from "../../src/billing/apply-subscription.js";
import { MemoryBillingLinkStore } from "../../src/billing/billing-links.js";
import { createBillingProvider } from "../../src/billing/create-provider.js";
import { MemoryBillingEventLog } from "../../src/billing/event-log.js";
import { PADDLE_LIVE_API, PADDLE_SANDBOX_API, priceIdForCheckout } from "../../src/billing/paddle-config.js";
import { PaddleApiError } from "../../src/billing/paddle-client.js";
import { interpretPaddleNotification } from "../../src/billing/paddle-events.js";
import { PaddleClient } from "../../src/billing/paddle-client.js";
import { verifyPaddleSignature, WEBHOOK_MAX_AGE_MS } from "../../src/billing/paddle-signature.js";
import { BillingCustomerMissingError, BillingNotConfiguredError, type PaddleSubject } from "../../src/billing/provider.js";
import { loadConfig } from "../../src/config.js";
import { createContext, runMaintenance } from "../../src/context.js";
import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";
import { api, signUp } from "../helpers/rest.js";

const SECRET = "whsec_test";
const KNOWN_BODY = '{"event_id":"evt_test","event_type":"subscription.activated"}';
const KNOWN_TS = 1_671_552_777;
const KNOWN_H1 = "15bc9c2ed7d12b76c15e59eb7a4cd0edb75666c86a447e288ef325d437bd5298";
const PRICES = { pro: "pri_pro", founding: "pri_found", creator: "pri_creator", team: "pri_team" };
const SUBJECT: PaddleSubject = { subscriptionId: "sub_1", customerId: null, transactionId: null, checkoutNonce: null };
const NONCE = "nonce_0123456789abcd";

describe("Paddle webhook signatures", () => {
  const body = Buffer.from(KNOWN_BODY, "utf8");
  const header = `ts=${KNOWN_TS};h1=${KNOWN_H1}`;

  it("accepts a known HMAC of ts:body", () => {
    expect(verifyPaddleSignature(body, header, SECRET, KNOWN_TS * 1000)).toEqual({ ok: true });
  });

  it("accepts a second h1 while a secret is rotating", () => {
    const rotated = `ts=${KNOWN_TS};h1=${"ab".repeat(32)};h1=${KNOWN_H1}`;
    expect(verifyPaddleSignature(body, rotated, SECRET, KNOWN_TS * 1000).ok).toBe(true);
  });

  it("rejects a bad signature, a missing header, and a timestamp older than 5 minutes", () => {
    expect(verifyPaddleSignature(body, `ts=${KNOWN_TS};h1=${"0".repeat(64)}`, SECRET, KNOWN_TS * 1000)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyPaddleSignature(body, undefined, SECRET, KNOWN_TS * 1000)).toEqual({ ok: false, reason: "missing_signature" });
    expect(verifyPaddleSignature(body, header, SECRET, KNOWN_TS * 1000 + WEBHOOK_MAX_AGE_MS).ok).toBe(true);
    expect(verifyPaddleSignature(body, header, SECRET, KNOWN_TS * 1000 + WEBHOOK_MAX_AGE_MS + 1)).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
  });
});

describe("Paddle notification mapping", () => {
  const now = Date.UTC(2026, 9, 12, 12);
  const future = new Date(now + 86_400_000).toISOString();

  it("maps founding and paid prices onto entitlements, and ignores unknown events", () => {
    expect(change("subscription.activated", data("usr_1", "pri_found"), now)).toEqual({
      kind: "assign",
      userId: "usr_1",
      plan: "pro",
      interval: "year",
      freeAt: null,
      subject: SUBJECT,
    });
    expect(change("transaction.completed", data("usr_1", "pri_pro"), now)).toBeNull();
  });

  it("keeps the plan until period end when Paddle schedules the cancel, and frees immediately otherwise", () => {
    const scheduled = change(
      "subscription.canceled",
      { ...data("usr_1", "pri_pro"), status: "canceled", scheduled_change: { action: "cancel", effective_at: future, resume_at: null } },
      now,
    );
    expect(scheduled).toMatchObject({ kind: "cancel", when: "period_end" });
    const period = change(
      "subscription.canceled",
      { ...data("usr_1", "pri_pro"), status: "canceled", current_billing_period: { ends_at: future } },
      now,
    );
    expect(period).toMatchObject({ kind: "cancel", when: "period_end" });
    expect(change("subscription.canceled", { ...data("usr_1", "pri_pro"), status: "canceled", scheduled_change: null }, now)).toEqual({
      kind: "cancel",
      userId: "usr_1",
      when: "immediate",
      effectiveAt: null,
      subject: SUBJECT,
    });
  });

  it("on update, sets the plan and remembers a future cancel", () => {
    expect(
      change("subscription.updated", { ...data("usr_1", "pri_creator"), scheduled_change: { action: "cancel", effective_at: future, resume_at: null } }, now),
    ).toEqual({ kind: "assign", userId: "usr_1", plan: "creator", interval: null, freeAt: Date.parse(future), subject: SUBJECT });
  });

  it("uses the subscription cycle, and does not treat a bare price or a missing cycle as yearly", () => {
    const prices = { ...PRICES, pro_month: "pri_pro_month", pro_year: "pri_pro_year", creator_month: "pri_creator" };
    const month = change("subscription.activated", { ...data("usr_1", "pri_pro_year"), billing_cycle: { interval: "month", frequency: 1 } }, now, prices);
    expect(month).toMatchObject({ kind: "assign", plan: "pro", interval: "month" });
    const fromKey = change("subscription.activated", data("usr_1", "pri_pro_month"), now, prices);
    expect(fromKey).toMatchObject({ kind: "assign", interval: "month" });
    const yearly = change("subscription.updated", { ...data("usr_1", "pri_pro_year"), billing_cycle: { interval: "year", frequency: 1 } }, now, prices);
    expect(yearly).toMatchObject({ kind: "assign", interval: "year" });
    const bare = change("subscription.activated", data("usr_1", "pri_pro"), now, prices);
    expect(bare).toMatchObject({ kind: "assign", interval: null });
    const week = change("subscription.activated", { ...data("usr_1", "pri_pro"), billing_cycle: { interval: "week", frequency: 1 } }, now, prices);
    expect(week).toMatchObject({ kind: "assign", interval: null });
  });

  it("keeps the checkout nonce and paddle ids beside the claimed user", () => {
    expect(
      change("subscription.activated", {
        ...data("usr_1", "pri_pro"),
        id: "sub_abc",
        customer_id: "ctm_abc",
        transaction_id: "txn_abc",
        custom_data: { user_id: "usr_1", checkout_nonce: NONCE },
      }, now),
    ).toMatchObject({
      userId: "usr_1",
      subject: { subscriptionId: "sub_abc", customerId: "ctm_abc", transactionId: "txn_abc", checkoutNonce: NONCE },
    });
  });
});

describe("applying subscription changes", () => {
  it("is idempotent on event id and frees the user when a scheduled cancel comes due", async () => {
    const users = new MemoryUserStore();
    const events = new MemoryBillingEventLog();
    const links = new MemoryBillingLinkStore();
    const now = Date.UTC(2026, 9, 12, 12);
    await users.create({ id: "usr_1", email: "a@example.test", passwordHash: "x", plan: "free", createdAt: now });
    const assign = { kind: "assign" as const, userId: "usr_1", plan: "pro" as const, interval: "month" as const, freeAt: null, subject: SUBJECT };
    expect(await applySubscriptionChange(users, events, links, "evt_0", assign, now)).toBe("ignored");
    expect((await users.findById("usr_1"))?.plan).toBe("free");
    expect(await links.bind("sub_1", "usr_1")).toBe(true);
    expect(await applySubscriptionChange(users, events, links, "evt_1", assign, now)).toBe("applied");
    expect(await applySubscriptionChange(users, events, links, "evt_1", { ...assign, plan: "team", interval: "year" }, now)).toBe("duplicate");
    expect((await users.findById("usr_1"))?.plan).toBe("pro");
    expect((await users.findById("usr_1"))?.billingInterval).toBe("month");
    expect(await applySubscriptionChange(users, events, links, "evt_keep", { ...assign, interval: null }, now)).toBe("applied");
    expect((await users.findById("usr_1"))?.billingInterval).toBe("month");

    const freeAt = now + 86_400_000;
    await applySubscriptionChange(users, events, links, "evt_2", { kind: "cancel", userId: "usr_1", when: "period_end", effectiveAt: freeAt, subject: SUBJECT }, now);
    expect((await users.findById("usr_1"))?.plan).toBe("pro");
    await applyDueDowngrades(users, events, freeAt);
    expect((await users.findById("usr_1"))?.plan).toBe("free");
    expect((await users.findById("usr_1"))?.billingInterval).toBeNull();
  });
});

describe("billing provider selection", () => {
  it("starts with the fake provider when no API key is set", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network");
    };
    const config = loadConfig({}, "linux");
    expect(config.paddle.apiKey).toBeUndefined();
    expect(config.paddle.apiBaseUrl).toBeUndefined();
    const provider = createBillingProvider(config, fetchImpl);
    expect(provider.kind).toBe("fake");
    const ctx = createContext(config);
    expect(ctx.billingProvider.kind).toBe("fake");
    await ctx.close();
    const session = await provider.createCheckout({ userId: "usr_1", email: "a@example.test", plan: "pro", interval: "month" });
    expect(session.transactionId).toBe("fake_1");
    await expect(provider.createPortalSession("usr_1")).rejects.toBeInstanceOf(BillingNotConfiguredError);
  });

  it("uses the sandbox host when the key contains sdbx, and the live host otherwise, via the injected fetch", async () => {
    const sandbox = await postedUrl("test_sdbx_key");
    expect(sandbox).toBe(`${PADDLE_SANDBOX_API}/transactions`);
    const live = await postedUrl("test_live_key");
    expect(live).toBe(`${PADDLE_LIVE_API}/transactions`);
  });

  it("does not put the response body on a failed Paddle call", async () => {
    const client = new PaddleClient("test_sdbx_key", PADDLE_SANDBOX_API, async () => new Response(JSON.stringify({ detail: "super-secret-body" }), { status: 409 }));
    await expect(client.createTransaction({ priceId: "pri_pro", userId: "usr_1", checkoutNonce: NONCE })).rejects.toMatchObject({
      name: "PaddleApiError",
      status: 409,
    });
    try {
      await client.createTransaction({ priceId: "pri_pro", userId: "usr_1", checkoutNonce: NONCE });
    } catch (error) {
      expect(error).toBeInstanceOf(PaddleApiError);
      expect((error as Error).message).not.toContain("super-secret-body");
    }
  });

  it("refuses a checkout whose price id is not configured, and does not echo a bad catalog value", async () => {
    const config = loadConfig({ PADDLE_API_KEY: "test_sdbx_key", PADDLE_PRICE_IDS: "pro=pri_pro" }, "linux");
    const provider = createBillingProvider(config, async () => {
      throw new Error("network");
    });
    expect(priceIdForCheckout(config.paddle.prices, "pro", "year")).toBe("pri_pro");
    expect(priceIdForCheckout({ pro_year: "pri_year", pro: "pri_month" }, "pro", "year")).toBe("pri_year");
    await expect(provider.createCheckout({ userId: "usr_1", email: "a@example.test", plan: "team", interval: "month" })).rejects.toBeInstanceOf(
      BillingNotConfiguredError,
    );
    try {
      loadConfig({ PADDLE_PRICE_IDS: "creator=not-a-price" }, "linux");
      throw new Error("expected a ConfigError");
    } catch (error) {
      expect((error as Error).message).toContain("PADDLE_PRICE_IDS");
      expect((error as Error).message).not.toContain("not-a-price");
    }
  });

  it("stores the transaction and nonce at checkout and will not apply a different user", async () => {
    const links = new MemoryBillingLinkStore();
    let sent = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ data: { id: "txn_checkout1", checkout: { url: null } } }), { status: 200 });
    };
    const provider = createBillingProvider(
      loadConfig({ PADDLE_API_KEY: "test_sdbx_key", PADDLE_PRICE_IDS: "pro=pri_pro", PADDLE_WEBHOOK_SECRET: SECRET }, "linux"),
      fetchImpl,
      links,
    );
    const session = await provider.createCheckout({ userId: "usr_1", email: "a@example.test", plan: "pro", interval: "month" });
    expect(session.transactionId).toBe("txn_checkout1");
    const body = JSON.parse(sent) as {
      custom_data: { user_id: string; checkout_nonce: string };
      customer?: { email?: string; id?: string };
      customer_id?: string;
      collection_mode?: string;
    };
    expect(body.custom_data.user_id).toBe("usr_1");
    expect(body.customer).toEqual({ email: "a@example.test" });
    expect(body.customer).not.toHaveProperty("id");
    expect(body.collection_mode).toBe("automatic");
    expect(body).not.toHaveProperty("customer_id");
    expect(body.custom_data.checkout_nonce.length).toBeGreaterThanOrEqual(16);
    expect(await links.userFor("txn_checkout1")).toBe("usr_1");
    expect(await links.userFor(body.custom_data.checkout_nonce)).toBe("usr_1");

    const users = new MemoryUserStore();
    const events = new MemoryBillingEventLog();
    const now = Date.UTC(2026, 9, 12, 12);
    await users.create({ id: "usr_1", email: "a@example.test", passwordHash: "x", plan: "free", createdAt: now });
    await users.create({ id: "usr_victim", email: "v@example.test", passwordHash: "x", plan: "free", createdAt: now });
    const subject: PaddleSubject = {
      subscriptionId: "sub_new",
      customerId: "ctm_new",
      transactionId: null,
      checkoutNonce: body.custom_data.checkout_nonce,
    };
    expect(
      await applySubscriptionChange(users, events, links, "evt_a", { kind: "assign", userId: "usr_1", plan: "pro", interval: null, freeAt: null, subject }, now),
    ).toBe("applied");
    expect((await users.findById("usr_1"))?.plan).toBe("pro");
    expect(await links.userFor("sub_new")).toBe("usr_1");

    const stolen: PaddleSubject = { ...subject, subscriptionId: "sub_stolen" };
    expect(
      await applySubscriptionChange(users, events, links, "evt_b", { kind: "assign", userId: "usr_victim", plan: "team", interval: null, freeAt: null, subject: stolen }, now),
    ).toBe("ignored");
    expect((await users.findById("usr_victim"))?.plan).toBe("free");
    expect(await links.userFor("sub_stolen")).toBeUndefined();

    const bare: PaddleSubject = { subscriptionId: "sub_bare", customerId: null, transactionId: null, checkoutNonce: null };
    expect(
      await applySubscriptionChange(users, events, links, "evt_bare", { kind: "assign", userId: "usr_victim", plan: "pro", interval: "year", freeAt: null, subject: bare }, now),
    ).toBe("ignored");
    expect((await users.findById("usr_victim"))?.plan).toBe("free");

    const customerOnly: PaddleSubject = { subscriptionId: null, customerId: "ctm_new", transactionId: null, checkoutNonce: null };
    expect(
      await applySubscriptionChange(users, events, links, "evt_cus", { kind: "assign", userId: "usr_1", plan: "creator", interval: "month", freeAt: null, subject: customerOnly }, now),
    ).toBe("applied");
    expect(
      await applySubscriptionChange(users, events, links, "evt_cus_bad", { kind: "assign", userId: "usr_victim", plan: "team", interval: null, freeAt: null, subject: customerOnly }, now),
    ).toBe("ignored");
    expect((await users.findById("usr_victim"))?.plan).toBe("free");
    expect((await users.findById("usr_1"))?.plan).toBe("creator");
  });
});

describe("POST /v1/paddle/webhook", () => {
  it("sets the plan from a signed event without CSRF, ignores unknown events, and rejects a bad signature", async () => {
    const clock = { value: Date.UTC(2026, 9, 12, 12) };
    const server = await startTestServer(paddleConfig(), { now: () => clock.value });
    try {
      await server.ctx.stores.users.create({
        id: "usr_paddle",
        email: "paddle@example.test",
        passwordHash: "x",
        plan: "free",
        createdAt: clock.value,
      });
      expect(await server.ctx.stores.billingLinks.bind("sub_1", "usr_paddle")).toBe(true);
      const activated = eventBody("evt_1", "subscription.activated", data("usr_paddle", "pri_pro"));
      const ok = await postWebhook(server, activated, sign(activated, clock.value), { cookie: "ms_session=abc; ms_csrf=xyz" });
      expect(ok.status).toBe(200);
      expect(ok.text).not.toContain("csrf");
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.billingInterval).toBeNull();

      const monthly = eventBody("evt_month", "subscription.updated", {
        ...data("usr_paddle", "pri_pro"),
        billing_cycle: { interval: "month", frequency: 1 },
      });
      expect((await postWebhook(server, monthly, sign(monthly, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.billingInterval).toBe("month");

      const replay = eventBody("evt_1", "subscription.activated", data("usr_paddle", "pri_team"));
      expect((await postWebhook(server, replay, sign(replay, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");

      const unknown = eventBody("evt_2", "transaction.completed", data("usr_paddle", "pri_team"));
      expect((await postWebhook(server, unknown, sign(unknown, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");

      const malformed = await postWebhook(server, "not-json", sign("not-json", clock.value));
      expect(malformed.status).toBe(400);
      expect((await postWebhook(server, activated, "ts=1;h1=" + "0".repeat(64))).status).toBe(401);
      const unsigned = await postWebhook(server, activated, undefined);
      expect(unsigned.status).toBe(401);
      expect(unsigned.text).not.toContain("csrf");
    } finally {
      await server.close();
    }
  });

  it("returns the user to free at period end, and immediately when Paddle does not schedule it", async () => {
    const clock = { value: Date.UTC(2026, 9, 12, 12) };
    const server = await startTestServer(paddleConfig(), { now: () => clock.value });
    try {
      await server.ctx.stores.users.create({
        id: "usr_paddle",
        email: "paddle@example.test",
        passwordHash: "x",
        plan: "pro",
        createdAt: clock.value,
      });
      expect(await server.ctx.stores.billingLinks.bind("sub_1", "usr_paddle")).toBe(true);
      const future = new Date(clock.value + 86_400_000).toISOString();
      const scheduled = eventBody("evt_end", "subscription.canceled", {
        ...data("usr_paddle", "pri_pro"),
        status: "canceled",
        scheduled_change: { action: "cancel", effective_at: future, resume_at: null },
      });
      expect((await postWebhook(server, scheduled, sign(scheduled, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");
      clock.value += 2 * 86_400_000;
      await runMaintenance(server.ctx);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("free");
      await server.ctx.stores.users.setPlan("usr_paddle", "pro");
      const immediate = eventBody("evt_now", "subscription.canceled", {
        ...data("usr_paddle", "pri_pro"),
        status: "canceled",
        scheduled_change: null,
      });
      expect((await postWebhook(server, immediate, sign(immediate, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("free");
    } finally {
      await server.close();
    }
  });

  it("refuses webhooks when no Paddle key is configured", async () => {
    const server = await startTestServer(testConfig());
    try {
      const body = eventBody("evt_1", "subscription.activated", data("usr_x", "pri_pro"));
      const response = await postWebhook(server, body, sign(body, Date.now()));
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("returns 200 and does not set a plan when the subscription was not created for that user", async () => {
    const clock = { value: Date.UTC(2026, 9, 12, 12) };
    const server = await startTestServer(paddleConfig(), { now: () => clock.value });
    try {
      await server.ctx.stores.users.create({
        id: "usr_paddle",
        email: "paddle@example.test",
        passwordHash: "x",
        plan: "free",
        createdAt: clock.value,
      });
      await server.ctx.stores.users.create({
        id: "usr_other",
        email: "other@example.test",
        passwordHash: "x",
        plan: "free",
        createdAt: clock.value,
      });
      const bare = eventBody("evt_bare", "subscription.activated", { ...data("usr_other", "pri_team"), id: "sub_other" });
      expect((await postWebhook(server, bare, sign(bare, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_other"))?.plan).toBe("free");

      expect(await server.ctx.stores.billingLinks.bind("txn_ours", "usr_paddle")).toBe(true);
      const created = eventBody("evt_created", "transaction.completed", {
        id: "txn_ours",
        subscription_id: "sub_new",
        customer_id: "ctm_new",
        custom_data: { user_id: "usr_paddle" },
      });
      expect((await postWebhook(server, created, sign(created, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("free");

      const activated = eventBody("evt_act", "subscription.activated", {
        id: "sub_new",
        status: "active",
        custom_data: { user_id: "usr_paddle" },
        items: [{ price: { id: "pri_pro" }, quantity: 1 }],
      });
      expect((await postWebhook(server, activated, sign(activated, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");

      const steal = eventBody("evt_steal", "subscription.updated", {
        id: "sub_new",
        status: "active",
        custom_data: { user_id: "usr_other" },
        items: [{ price: { id: "pri_team" }, quantity: 1 }],
      });
      expect((await postWebhook(server, steal, sign(steal, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_other"))?.plan).toBe("free");
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");

      const cancelOther = eventBody("evt_cancel_other", "subscription.canceled", {
        id: "sub_new",
        status: "canceled",
        custom_data: { user_id: "usr_other" },
        scheduled_change: null,
      });
      expect((await postWebhook(server, cancelOther, sign(cancelOther, clock.value))).status).toBe(200);
      expect((await server.ctx.stores.users.findById("usr_paddle"))?.plan).toBe("pro");
      expect((await server.ctx.stores.users.findById("usr_other"))?.plan).toBe("free");
    } finally {
      await server.close();
    }
  });
});

it("grants pack credits and one extra seat without replacing the plan", async () => {
    const prices = { ...PRICES, pack_500: "pri_pack500", seat: "pri_seat" };
    const users = new MemoryUserStore();
    const events = new MemoryBillingEventLog();
    const links = new MemoryBillingLinkStore();
    const now = Date.UTC(2026, 9, 12, 12);
    await users.create({ id: "usr_1", email: "a@example.test", passwordHash: "x", plan: "creator", createdAt: now });
    await links.bind("txn_pack1", "usr_1");
    await links.bind(NONCE, "usr_1");
    const pack = interpretPaddleNotification(
      JSON.stringify({
        event_id: "evt_pack",
        event_type: "transaction.completed",
        data: {
          id: "txn_pack1",
          status: "completed",
          custom_data: { user_id: "usr_1", checkout_nonce: NONCE },
          items: [{ price: { id: "pri_pack500" }, quantity: 1 }],
        },
      }),
      prices,
      now,
    );
    if (!pack.ok || pack.change === null) throw new Error("expected a pack grant");
    expect(pack.change.kind).toBe("grant_pack");
    expect(await applySubscriptionChange(users, events, links, "evt_pack", pack.change, now)).toBe("applied");
    expect((await users.findById("usr_1"))?.plan).toBe("creator");
    expect((await users.findById("usr_1"))?.bonusCredits).toBe(500);
    expect(await applySubscriptionChange(users, events, links, "evt_pack", pack.change, now)).toBe("duplicate");
    expect((await users.findById("usr_1"))?.bonusCredits).toBe(500);

    await users.setPlan("usr_1", "team");
    await links.bind("sub_seat1", "usr_1");
    const seat = interpretPaddleNotification(
      JSON.stringify({
        event_id: "evt_seat",
        event_type: "subscription.activated",
        data: {
          id: "sub_seat1",
          status: "active",
          custom_data: { user_id: "usr_1", checkout_nonce: NONCE },
          items: [{ price: { id: "pri_seat" }, quantity: 1 }],
        },
      }),
      prices,
      now,
    );
    if (!seat.ok || seat.change === null) throw new Error("expected a seat");
    expect(await applySubscriptionChange(users, events, links, "evt_seat", seat.change, now)).toBe("applied");
    expect((await users.findById("usr_1"))?.extraSeats).toBe(1);
    expect((await users.findById("usr_1"))?.plan).toBe("team");

    const renewal = interpretPaddleNotification(
      JSON.stringify({
        event_id: "evt_seat_pay",
        event_type: "transaction.completed",
        data: {
          id: "txn_seat1",
          subscription_id: "sub_seat1",
          status: "completed",
          custom_data: { user_id: "usr_1", checkout_nonce: NONCE },
          items: [{ price: { id: "pri_seat" }, quantity: 1 }],
        },
      }),
      prices,
      now,
    );
    if (!renewal.ok || renewal.change === null) throw new Error("expected a seat renewal");
    await links.bind("txn_seat1", "usr_1");
    expect(await applySubscriptionChange(users, events, links, "evt_seat_pay", renewal.change, now)).toBe("applied");
    expect((await users.findById("usr_1"))?.extraSeats).toBe(1);

    const canceled = interpretPaddleNotification(
      JSON.stringify({
        event_id: "evt_seat_cancel",
        event_type: "subscription.canceled",
        data: {
          id: "sub_seat1",
          status: "canceled",
          custom_data: { user_id: "usr_1", checkout_nonce: NONCE },
          items: [{ price: { id: "pri_seat" }, quantity: 1 }],
        },
      }),
      prices,
      now,
    );
    if (!canceled.ok || canceled.change === null) throw new Error("expected a seat cancel");
    expect(await applySubscriptionChange(users, events, links, "evt_seat_cancel", canceled.change, now)).toBe("applied");
    expect((await users.findById("usr_1"))?.plan).toBe("team");
    expect((await users.findById("usr_1"))?.extraSeats).toBe(0);
  });

function change(eventType: string, data: unknown, now: number, prices: Readonly<Record<string, string>> = PRICES) {
  const raw = JSON.stringify({ event_id: "evt_1", event_type: eventType, data });
  const interpreted = interpretPaddleNotification(raw, prices, now);
  if (!interpreted.ok) throw new Error("expected a parsed event");
  return interpreted.change;
}

function data(userId: string, priceId: string) {
  return { id: "sub_1", status: "active", custom_data: { user_id: userId }, items: [{ price: { id: priceId }, quantity: 1 }] };
}

function eventBody(eventId: string, eventType: string, dataBody: unknown): string {
  return JSON.stringify({ event_id: eventId, event_type: eventType, data: dataBody });
}

function sign(body: string, now: number): string {
  const ts = Math.floor(now / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

function paddleConfig() {
  return testConfig({
    PADDLE_API_KEY: "test_sdbx_key",
    PADDLE_WEBHOOK_SECRET: SECRET,
    PADDLE_PRICE_IDS: "creator=pri_creator,pro=pri_pro,team=pri_team,founding=pri_found",
  });
}

async function postWebhook(server: RunningServer, body: string, signature: string | undefined, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (signature !== undefined) headers["paddle-signature"] = signature;
  const response = await fetch(`${server.baseUrl}/v1/paddle/webhook`, { method: "POST", headers, body });
  return { status: response.status, text: await response.text() };
}

async function postedUrl(apiKey: string): Promise<string> {
  let url = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    const header = new Headers(init?.headers).get("authorization") ?? "";
    if (!header.startsWith("Bearer ") || header.includes("\n")) throw new Error("bad authorization header");
    return new Response(JSON.stringify({ data: { id: "txn_1", checkout: { url: "https://checkout.example.test/txn_1" } } }), { status: 200 });
  };
  const provider = createBillingProvider(
    loadConfig({ PADDLE_API_KEY: apiKey, PADDLE_PRICE_IDS: "pro=pri_pro" }, "linux"),
    fetchImpl,
  );
  await provider.createCheckout({ userId: "usr_1", email: "a@example.test", plan: "pro", interval: "month" });
  return url;
}

describe("saved Paddle customer and subscription interval", () => {
  it("passes a stored ctm_ id on the next checkout and never an email or user id", async () => {
    const links = new MemoryBillingLinkStore();
    await links.bind("ctm_savedcustomer", "usr_1");
    await links.bind("usr_1", "usr_1");
    let sent = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ data: { id: "txn_again", checkout: { url: "https://checkout.example.test/again" } } }), { status: 200 });
    };
    const provider = createBillingProvider(
      loadConfig({ PADDLE_API_KEY: "test_sdbx_key", PADDLE_PRICE_IDS: "pro_month=pri_promonth,pro_year=pri_proyear" }, "linux"),
      fetchImpl,
      links,
    );
    await provider.createCheckout({ userId: "usr_1", email: "a@example.test", plan: "pro", interval: "month" });
    const body = JSON.parse(sent) as { customer_id?: string; customer?: { email?: string }; collection_mode?: string; items?: { price_id?: string }[] };
    expect(body.customer_id).toBe("ctm_savedcustomer");
    expect(body.customer_id).not.toBe("usr_1");
    expect(body.customer_id).not.toContain("@");
    expect(body.customer).toBeUndefined();
    expect(body.collection_mode).toBe("automatic");
    expect(body.items?.[0]?.price_id).toBe("pri_promonth");
  });

  it("reads month from the linked subscription and leaves a missing cycle null", async () => {
    const links = new MemoryBillingLinkStore();
    await links.bind("sub_month", "usr_1");
    await links.bind("sub_blank", "usr_2");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/subscriptions/sub_month")) {
        return new Response(JSON.stringify({ data: { id: "sub_month", billing_cycle: { interval: "month", frequency: 1 }, items: [] } }), { status: 200 });
      }
      if (url.endsWith("/subscriptions/sub_blank")) {
        return new Response(JSON.stringify({ data: { id: "sub_blank", items: [{ price: { id: "pri_unknown" } }] } }), { status: 200 });
      }
      return new Response("no", { status: 500 });
    };
    const provider = createBillingProvider(
      loadConfig({ PADDLE_API_KEY: "test_sdbx_key", PADDLE_PRICE_IDS: "pro=pri_pro" }, "linux"),
      fetchImpl,
      links,
    );
    expect(await provider.subscriptionInterval("usr_1")).toBe("month");
    expect(await provider.subscriptionInterval("usr_2")).toBeNull();
    expect(await provider.subscriptionInterval("usr_missing")).toBeNull();
  });

  it("returns the stored interval from /v1/me and does not invent year", async () => {
    const server = await startTestServer(testConfig());
    try {
      const account = await signUp(server);
      const user = await server.ctx.stores.users.findByEmail(account.email);
      if (user === undefined) throw new Error("account missing");
      await server.ctx.stores.users.setPlan(user.id, "creator");
      const missing = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      expect(missing.status).toBe(200);
      expect(missing.body.plan).toBe("creator");
      expect(missing.body.billing_interval).toBeNull();
      await server.ctx.stores.users.setBillingInterval(user.id, "month");
      const monthly = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      expect(monthly.body.billing_interval).toBe("month");
      await server.ctx.stores.users.setBillingInterval(user.id, "year");
      const yearly = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      expect(yearly.body.billing_interval).toBe("year");
    } finally {
      await server.close();
    }
  });
});

describe("Paddle portal and cancel", () => {
  it("returns only an https portal URL and treats an already-cancelled subscription as done", async () => {
    const links = new MemoryBillingLinkStore();
    await links.bind("ctm_portal1", "usr_1");
    await links.bind("sub_portal1", "usr_1");
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/portal-sessions")) {
        return new Response(JSON.stringify({ data: { urls: { general: { overview: "https://customer-portal.paddle.com/cpl_1" } } } }), {
          status: 200,
        });
      }
      if (url.endsWith("/cancel")) return new Response("{}", { status: 409 });
      return new Response("no", { status: 500 });
    };
    const provider = createBillingProvider(
      loadConfig({ PADDLE_API_KEY: "test_sdbx_key", PADDLE_PRICE_IDS: "pro=pri_pro" }, "linux"),
      fetchImpl,
      links,
    );
    expect((await provider.createPortalSession("usr_1")).url).toBe("https://customer-portal.paddle.com/cpl_1");
    await provider.cancelSubscriptions("usr_1");
    expect(calls.some((url) => url.endsWith("/subscriptions/sub_portal1/cancel"))).toBe(true);
    await expect(provider.createPortalSession("usr_missing")).rejects.toBeInstanceOf(BillingCustomerMissingError);
  });
});
