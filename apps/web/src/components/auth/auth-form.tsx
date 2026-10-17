"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { pathAfterAuth } from "../../lib/auth-next";
import { chatgptConnectHref } from "../../lib/chatgpt-connect";
import { connectSearch, type ConnectRequest } from "../../lib/connect-query";
import { ChatgptMark, GoogleMark } from "./provider-marks";

type Mode = "login" | "signup";

const PAGE_ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in is not set up on this server yet. Email and password still work.",
  google_denied: "Google sign-in was cancelled.",
  google_failed: "Google sign-in could not be verified. Try again.",
  google_unverified: "Google did not confirm that email. Choose a verified Google account, or use email and password.",
  google_existing_unverified: "An account with this email already exists and is not verified. Sign in with the password first.",
  chatgpt_start:
    "Plugins → Add custom MCP server → https://api.mutescroll.xyz/mcp → OAuth. ChatGPT opens MuteScroll so you can allow it to read a public video link as this account.",
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
  const otherHref = mode === "login" ? hrefFor("/signup", next, connect) : hrefFor("/login", next, connect);
  const googleHref = `/api/v1/auth/google?mode=${mode}&next=${encodeURIComponent(googleNext(next, connect))}`;
  const chatgptHref = chatgptConnectHref(connect);

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
      window.location.assign(connect === undefined ? pathAfterAuth(next) : chatgptHref);
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
        <a className="btn auth-provider" href={chatgptHref}>
          <ChatgptMark />
          <span className="auth-provider-label">Continue with ChatGPT</span>
        </a>
      </div>
      <p className="auth-divider">or email</p>
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
    </>
  );
}

function googleNext(next: string | undefined, connect: ConnectRequest | undefined): string {
  if (connect !== undefined) return chatgptConnectHref(connect);
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
