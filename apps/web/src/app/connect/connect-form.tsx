"use client";

import { useEffect, useState, type FormEvent } from "react";

import { GoogleMark } from "../../components/auth/provider-marks";
import { readCsrf } from "../../lib/csrf";

export interface ConnectQuery {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly state: string;
  readonly scope: string;
  readonly resource: string;
}

type Mode = "login" | "signup";

export function ConnectForm({ query }: { readonly query: ConnectQuery }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);
  const googleHref = `/api/v1/auth/google?mode=${mode}&next=${encodeURIComponent(connectReturn(query))}`;

  useEffect(() => {
    if (query.clientId === "") return;
    let cancelled = false;
    void fetch(`/api/oauth/client?client_id=${encodeURIComponent(query.clientId)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setClientName("MCP client");
          return;
        }
        const body = (await response.json()) as { client_name?: string };
        const name = typeof body.client_name === "string" ? body.client_name.trim() : "";
        setClientName(name === "" ? "MCP client" : name);
      })
      .catch(() => {
        if (!cancelled) setClientName("MCP client");
      });
    return () => {
      cancelled = true;
    };
  }, [query.clientId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/me", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { email?: string };
        if (!cancelled && typeof body.email === "string") setSignedIn(body.email);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (query.clientId === "") {
    return (
      <div className="container page legal">
        <header className="page-head">
          <h1 className="display-small">Connect ChatGPT</h1>
          <p className="section-lede">
            Plugins → Add custom MCP server → https://api.mutescroll.xyz/mcp → OAuth. ChatGPT opens this page so you
            can allow it to read a public video link as this account.
          </p>
        </header>
        {signedIn === null ? (
          <p>Sign in on this page when ChatGPT opens it. Continue with ChatGPT is MuteScroll&apos;s connector.</p>
        ) : (
          <p>Signed in as {signedIn}. ChatGPT opens the approval on this page.</p>
        )}
      </div>
    );
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    const path = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/signup";
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { email?: string; error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "That sign-in did not work.");
        return;
      }
      setSignedIn(body.email ?? email);
    } catch {
      setError("The connection failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function allow(): Promise<void> {
    setPending(true);
    setError("");
    const token = readCsrf();
    try {
      const response = await fetch("/api/oauth/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          client_id: query.clientId,
          redirect_uri: query.redirectUri,
          code_challenge: query.codeChallenge,
          code_challenge_method: query.codeChallengeMethod,
          state: query.state,
          scope: query.scope,
          ...(query.resource === "" ? {} : { resource: query.resource }),
        }),
      });
      const body = (await response.json()) as { redirect_to?: string; error?: { message?: string } };
      if (!response.ok || body.redirect_to === undefined) {
        setError(body.error?.message ?? "MuteScroll could not approve this connection.");
        return;
      }
      window.location.assign(body.redirect_to);
    } catch {
      setError("The connection failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">{clientName === null ? "Allow" : `Allow ${clientName}`}</h1>
        {clientName === null ? null : (
          <p className="section-lede">Allow {clientName} to read a public video link as this account.</p>
        )}
      </header>

      {signedIn === null ? (
        <form className="paste" onSubmit={(event) => void submitAccount(event)}>
          <div className="auth-providers">
            <a className="btn btn-primary auth-provider" href={googleHref}>
              <GoogleMark />
              <span className="auth-provider-label">Continue with Google</span>
            </a>
          </div>
          <p className="auth-divider">or email</p>
          <label className="field-label" htmlFor="connect-email">
            Email
          </label>
          <input
            id="connect-email"
            className="field-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label className="field-label" htmlFor="connect-password">
            Password
          </label>
          <input
            id="connect-password"
            className="field-input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "signup" ? <p className="field-hint">Use at least 10 characters.</p> : null}
          {error === "" ? null : <p className="field-error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Create an account" : "I already have an account"}
          </button>
        </form>
      ) : (
        <div className="paste">
          <p>Signed in as {signedIn}.</p>
          {error === "" ? null : <p className="field-error">{error}</p>}
          <button className="btn btn-primary" type="button" disabled={pending || clientName === null} onClick={() => void allow()}>
            {clientName === null ? "Allow" : `Allow ${clientName}`}
          </button>
        </div>
      )}
    </div>
  );
}

function connectReturn(query: ConnectQuery): string {
  const search = new URLSearchParams({
    client_id: query.clientId,
    redirect_uri: query.redirectUri,
    code_challenge: query.codeChallenge,
    code_challenge_method: query.codeChallengeMethod,
    state: query.state,
    scope: query.scope,
  });
  if (query.resource !== "") search.set("resource", query.resource);
  return `/connect?${search.toString()}`;
}
