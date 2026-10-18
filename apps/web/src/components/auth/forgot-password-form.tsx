"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  CONNECTION_MESSAGE,
  FORGOT_PASSWORD_PATH,
  INBOX_MESSAGE,
  forgotResult,
  postAuthJson,
} from "../../lib/auth-mail";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await postAuthJson(FORGOT_PASSWORD_PATH, { email });
      const outcome = forgotResult(result.status, result.body);
      if (outcome.ok) {
        setDone(true);
        return;
      }
      setError(outcome.message);
    } catch {
      setError(CONNECTION_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="paste">
        <p role="status">{INBOX_MESSAGE}</p>
        <p className="field-hint">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="paste" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor="forgot-email">
        Email
      </label>
      <input
        id="forgot-email"
        className="field-input"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        Send reset link
      </button>
      <p className="field-hint">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
