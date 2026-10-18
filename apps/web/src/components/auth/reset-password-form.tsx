"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  CONNECTION_MESSAGE,
  INVALID_LINK_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_UPDATED_MESSAGE,
  RESET_PASSWORD_PATH,
  postAuthJson,
  resetResult,
} from "../../lib/auth-mail";

export function ResetPasswordForm({ token }: { readonly token: string | undefined }) {
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (token === undefined || token === "") {
    return (
      <div className="paste">
        <p className="field-error" role="alert">
          {INVALID_LINK_MESSAGE}
        </p>
        <p className="field-hint">
          <Link href="/forgot-password">Request a new link</Link>
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    if (password !== repeated) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    setPending(true);
    try {
      const result = await postAuthJson(RESET_PASSWORD_PATH, { token, password });
      const outcome = resetResult(result.status, result.body);
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
        <p role="status">{PASSWORD_UPDATED_MESSAGE}</p>
        <p className="field-hint">
          <Link href="/login">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="paste" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor="reset-password">
        New password
      </label>
      <input
        id="reset-password"
        className="field-input"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <label className="field-label" htmlFor="reset-password-repeat">
        Repeat password
      </label>
      <input
        id="reset-password-repeat"
        className="field-input"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        value={repeated}
        onChange={(event) => setRepeated(event.target.value)}
      />
      <p className="field-hint">Use at least 10 characters.</p>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        Update password
      </button>
    </form>
  );
}
