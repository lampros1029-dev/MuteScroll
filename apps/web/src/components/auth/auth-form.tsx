"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { pathAfterAuth } from "../../lib/auth-next";

type Mode = "login" | "signup";

export function AuthForm({ mode, next }: { readonly mode: Mode; readonly next: string | undefined }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const otherHref = mode === "login" ? hrefFor("/signup", next) : hrefFor("/login", next);

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
      window.location.assign(pathAfterAuth(next));
    } catch {
      setError("The connection failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
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
        {mode === "login" ? (
          <Link href={otherHref}>Create an account</Link>
        ) : (
          <Link href={otherHref}>I already have an account</Link>
        )}
      </p>
    </form>
  );
}

function hrefFor(path: "/login" | "/signup", next: string | undefined): string {
  if (next === undefined || next === "") return path;
  return `${path}?next=${encodeURIComponent(next)}`;
}
