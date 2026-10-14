"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { connectSearch, type ConnectRequest } from "../../lib/connect-query";
import { pathAfterAuth } from "../../lib/auth-next";
import { csrfHeaders } from "../../lib/csrf";
import { ChatgptMark, GoogleMark } from "./provider-marks";

type Mode = "login" | "signup";

const CHATGPT_ARM = "ms_chatgpt_approve";

const PAGE_ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in is not set up on this server yet. Email and password still work.",
  google_denied: "Google sign-in was cancelled.",
  google_failed: "Google sign-in could not be verified. Try again.",
  google_unverified: "Google did not confirm that email. Choose a verified Google account, or use email and password.",
  google_existing_unverified: "An account with this email already exists and is not verified. Sign in with the password first.",
  chatgpt_start:
    "OpenAI does not offer public ChatGPT sign-in for websites. In ChatGPT, add the MuteScroll connector at https://api.mutescroll.xyz/mcp and choose OAuth. ChatGPT opens this site so you can sign in and allow it to use the account.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
};

export function AuthForm({
  mode,
  next,
  initialError,
  connect,
}: {
  readonly mode: Mode;
  readonly next: string | undefined;
  readonly initialError: string | undefined;
  readonly connect: ConnectRequest | undefined;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(PAGE_ERRORS[initialError ?? ""] ?? "");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const approved = useRef(false);
  const otherHref = mode === "login" ? hrefFor("/signup", next, connect) : hrefFor("/login", next, connect);
  const googleHref = `/api/v1/auth/google?mode=${mode}&next=${encodeURIComponent(googleNext(mode, next, connect))}`;

  useEffect(() => {
    if (connect === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const signedIn = await hasSession();
        if (cancelled) return;
        if (signedIn) setReady(true);
        if (!signedIn || window.sessionStorage.getItem(CHATGPT_ARM) !== "1" || approved.current) return;
        approved.current = true;
        await approve(connect, setError);
      } catch {
        if (!cancelled) setError("The connection failed. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    const path = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/signup";
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
      if (!response.ok) {
        setError(body?.error?.message ?? "That did not work. Try again.");
        return;
      }
      if (connect !== undefined && window.sessionStorage.getItem(CHATGPT_ARM) === "1") {
        await approve(connect, setError);
        return;
      }
      if (connect !== undefined) {
        setReady(true);
        return;
      }
      window.location.assign(pathAfterAuth(next));
    } catch {
      setError("The connection failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function continueChatgpt(): Promise<void> {
    if (connect === undefined) {
      window.location.assign(`/api/v1/auth/chatgpt?mode=${mode}`);
      return;
    }
    setPending(true);
    setError("");
    window.sessionStorage.setItem(CHATGPT_ARM, "1");
    try {
      if (!(await hasSession())) {
        setError("Sign in with email or Google on this page. Continue with ChatGPT then allows ChatGPT to use this account.");
        return;
      }
      await approve(connect, setError);
    } catch {
      setError("The connection failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="auth-providers">
        <a className="btn btn-primary auth-provider" href={googleHref}>
          <GoogleMark />
          <span className="auth-provider-label">Continue with Google</span>
        </a>
        <button className="btn auth-provider" type="button" disabled={pending} onClick={() => void continueChatgpt()}>
          <ChatgptMark />
          <span className="auth-provider-label">Continue with ChatGPT</span>
        </button>
      </div>
      <p className="auth-divider">or email</p>
      {ready && connect !== undefined ? (
        <div className="paste">
          <p>Signed in. Continue with ChatGPT allows ChatGPT to use this account.</p>
          {error === "" ? null : (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <form className="paste" onSubmit={(event) => void submit(event)}>
          <label className="field-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            className="field-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label className="field-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            className="field-input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "signup" ? <p className="field-hint">Use at least 10 characters.</p> : null}
          {error === "" ? null : (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
          <p className="field-hint">
            {mode === "login" ? <Link href={otherHref}>Create an account</Link> : <Link href={otherHref}>I already have an account</Link>}
          </p>
        </form>
      )}
    </>
  );
}

async function hasSession(): Promise<boolean> {
  const response = await fetch("/api/v1/me", { headers: { accept: "application/json" }, cache: "no-store" });
  return response.ok;
}

async function approve(connect: ConnectRequest, setError: (message: string) => void): Promise<void> {
  const response = await fetch("/api/v1/auth/chatgpt", {
    method: "POST",
    headers: csrfHeaders(true),
    body: JSON.stringify({
      client_id: connect.clientId,
      redirect_uri: connect.redirectUri,
      code_challenge: connect.codeChallenge,
      code_challenge_method: connect.codeChallengeMethod,
      state: connect.state,
      scope: connect.scope,
      ...(connect.resource === "" ? {} : { resource: connect.resource }),
    }),
  });
  const body = (await response.json().catch(() => undefined)) as { redirect_to?: string; error?: { message?: string } } | undefined;
  if (!response.ok || body?.redirect_to === undefined) {
    setError(body?.error?.message ?? "MuteScroll could not approve ChatGPT.");
    return;
  }
  window.sessionStorage.removeItem(CHATGPT_ARM);
  window.location.assign(body.redirect_to);
}

function googleNext(mode: Mode, next: string | undefined, connect: ConnectRequest | undefined): string {
  if (connect !== undefined) return `/${mode}?${connectSearch(connect).toString()}`;
  return pathAfterAuth(next);
}

function hrefFor(path: "/login" | "/signup", next: string | undefined, connect: ConnectRequest | undefined): string {
  const search = new URLSearchParams();
  if (next !== undefined && next !== "") search.set("next", next);
  if (connect !== undefined) {
    const fields = connectSearch(connect);
    for (const [key, value] of fields) search.set(key, value);
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}
