// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountPanel } from "../app/account/account-panel";
import { ConnectForm, type ConnectQuery } from "../app/connect/connect-form";
import { DeveloperSetup } from "../app/developers/setup";
import { AuthForm } from "../components/auth/auth-form";
import { chatgptConnectHref } from "./chatgpt-connect";
import type { ConnectRequest } from "./connect-query";

const REQUEST: ConnectRequest = {
  clientId: "chatgpt-client",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  codeChallenge: "challenge-value",
  codeChallengeMethod: "S256",
  state: "chatgpt-state",
  scope: "transcribe",
  resource: "https://api.mutescroll.xyz/mcp",
};

const QUERY: ConnectQuery = {
  clientId: REQUEST.clientId,
  redirectUri: REQUEST.redirectUri,
  codeChallenge: REQUEST.codeChallenge,
  codeChallengeMethod: REQUEST.codeChallengeMethod,
  state: REQUEST.state,
  scope: REQUEST.scope,
  resource: REQUEST.resource,
};

const EMPTY: ConnectQuery = {
  clientId: "",
  redirectUri: "",
  codeChallenge: "",
  codeChallengeMethod: "",
  state: "",
  scope: "",
  resource: "",
};

function approvalFetch(url: string, clientName: string): Promise<Response> {
  if (url.startsWith("/api/oauth/client")) return Promise.resolve(jsonResponse(200, { client_name: clientName }));
  return Promise.resolve(jsonResponse(200, { email: "reader@example.test" }));
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("Continue with ChatGPT", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a person with no ChatGPT request to MuteScroll's connector page", () => {
    expect(chatgptConnectHref(undefined)).toBe("/connect");
    render(<AuthForm mode="login" next={undefined} initialError={undefined} connect={undefined} />);
    const link = screen.getByRole("link", { name: "Continue with ChatGPT" });
    expect(link.getAttribute("href")).toBe("/connect");
    expect(link.getAttribute("href")).not.toContain("openai.com");
    expect(link.getAttribute("href")).not.toContain("/api/v1/auth/chatgpt");
    expect(document.body.textContent ?? "").not.toMatch(/Developer Mode/i);
  });

  it("sends an in-flight ChatGPT authorization to the approval page", () => {
    const href = chatgptConnectHref(REQUEST);
    expect(href.startsWith("/connect?")).toBe(true);
    expect(href).toContain("client_id=chatgpt-client");
    expect(href).toContain("state=chatgpt-state");
    expect(href).toContain("code_challenge=challenge-value");
    expect(href).not.toContain("openai.com");

    render(<AuthForm mode="signup" next={undefined} initialError={undefined} connect={REQUEST} />);
    const link = screen.getByRole("link", { name: "Continue with ChatGPT" });
    expect(link.getAttribute("href")).toBe(href);
    const google = screen.getByRole("link", { name: "Continue with Google" });
    expect(google.getAttribute("href")).toContain(encodeURIComponent(href));
  });

  it("shows the plain-language approval when ChatGPT has opened the connector", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => approvalFetch(url, "ChatGPT")));
    render(<ConnectForm query={QUERY} />);
    expect(await screen.findByText("Allow ChatGPT to read a public video link as this account.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Allow ChatGPT" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow ChatGPT" })).toBeTruthy();
    expect(screen.getByText("Signed in as reader@example.test.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/\/pricing|\/checkout|Developer Mode/i);
  });

  it("uses the registered display name when another assistant opens the connector", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => approvalFetch(url, "Claude")));
    render(
      <ConnectForm
        query={{
          ...QUERY,
          clientId: "claude-client",
          redirectUri: "https://claude.ai/api/mcp/auth_callback",
        }}
      />,
    );
    expect(await screen.findByText("Allow Claude to read a public video link as this account.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Allow Claude" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow Claude" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Allow ChatGPT|Developer Mode|youtube|vimeo|tiktok/i);
  });

  it("lets a signed-out person start from the connector steps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, {})));
    render(<ConnectForm query={EMPTY} />);
    expect(await screen.findByText(/Plugins → Add custom MCP server → https:\/\/api\.mutescroll\.xyz\/mcp → OAuth/)).toBeTruthy();
    expect(screen.getByText(/Sign in on this page when ChatGPT opens it/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/openai\.com|Developer Mode/i);
  });

  it("keeps one developers panel visible and links ChatGPT to the connector", () => {
    render(<DeveloperSetup mcpUrl="https://api.mutescroll.xyz/mcp" />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "ChatGPT" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Continue with ChatGPT" }).getAttribute("href")).toBe("/connect");
    const panel = screen.getByRole("tabpanel").textContent ?? "";
    expect(panel).toContain("Plugins → Add custom MCP server");
    expect(panel).toContain("https://api.mutescroll.xyz/mcp");
    expect(panel).not.toContain("custom connector");
    expect(panel).not.toMatch(/Developer Mode/i);
  });

  it("links a signed-in account to the connector without a billing control", async () => {
    document.cookie = "ms_csrf=csrf-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/me") {
          return jsonResponse(200, {
            email: "reader@example.test",
            plan: "free",
            billing_interval: null,
            credits: { remaining: 5, allowance: 5, used: 0, bonus: 0, resets_at: "2026-11-01T00:00:00.000Z" },
            seats: { included: 1, extra: 0 },
            created_at: "2026-10-01T00:00:00.000Z",
          });
        }
        if (url === "/api/v1/api-keys") return jsonResponse(200, { items: [] });
        if (url === "/api/v1/oauth/grants") return jsonResponse(200, { grants: [] });
        return jsonResponse(404, {});
      }),
    );
    render(<AccountPanel />);
    const link = await screen.findByRole("link", { name: "Connect with ChatGPT" });
    expect(link.getAttribute("href")).toBe("/connect");
    expect(document.body.textContent ?? "").not.toMatch(/Developer Mode/i);
  });
});
