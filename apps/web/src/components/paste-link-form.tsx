"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { detectPlatform, normalizeLink } from "../lib/platform";

/** Landing-page box. It shows the platform as you type, then hands the link to /try. */
export function PasteLinkForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const hint = detectPlatform(value);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = normalizeLink(value);
    if (link === null) {
      setError("Paste a full public video link, starting with https://.");
      return;
    }
    setError(null);
    router.push(`/try?url=${encodeURIComponent(link)}`);
  }

  const hintText =
    hint.kind === "link" ? `${hint.label} link. ${hint.note}` : hint.kind === "invalid" ? "This doesn't look like a link yet." : "";

  return (
    <form className="paste" action="/try" method="get" onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId} className="field-label">
        Paste a video link
      </label>
      <div className="paste-row">
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          value={value}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            if (error !== null) setError(null);
          }}
          aria-describedby={`${hintId} ${errorId}`}
          aria-invalid={error !== null}
          className="field-input"
        />
        <button type="submit" className="btn btn-primary">
          Transcribe
        </button>
      </div>
      <p id={hintId} className={`field-hint hint-${hint.kind}`}>
        {hintText}
      </p>
      <p id={errorId} className="field-error" role={error === null ? undefined : "alert"}>
        {error ?? ""}
      </p>
    </form>
  );
}
