"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  CONFIRM_EMAIL_PATH,
  CONNECTION_MESSAGE,
  EMAIL_CONFIRMED_MESSAGE,
  INVALID_LINK_MESSAGE,
  confirmResult,
  postAuthJson,
} from "../../lib/auth-mail";

export function VerifyEmailForm({ token }: { readonly token: string | undefined }) {
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
          A signed-in account can request a new confirmation from the <Link href="/account">account page</Link>.
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await postAuthJson(CONFIRM_EMAIL_PATH, { token });
      const outcome = confirmResult(result.status, result.body);
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
        <p role="status">{EMAIL_CONFIRMED_MESSAGE}</p>
        <p className="field-hint">
          <Link href="/account">Account</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="paste" onSubmit={(event) => void submit(event)}>
      <p className="field-hint">This link works once.</p>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        Confirm email
      </button>
    </form>
  );
}
