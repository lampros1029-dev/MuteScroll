"use client";

import { useId, useState, type FormEvent } from "react";

import { LANGUAGE_OPTIONS } from "../../lib/languages";
import { detectPlatform, normalizeLink } from "../../lib/platform";

interface LinkFormProps {
  readonly defaultUrl: string;
  readonly onSubmit: (link: string, language: string) => void;
}

export function LinkForm({ defaultUrl, onSubmit }: LinkFormProps) {
  const [value, setValue] = useState(defaultUrl);
  const [language, setLanguage] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();
  const languageId = useId();
  const hintId = useId();
  const errorId = useId();
  const hint = detectPlatform(value);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = normalizeLink(value);
    if (link === null) {
      setError("Paste a full public video link, starting with https://.");
      return;
    }
    setError(null);
    onSubmit(link, language);
  }

  const hintText = hint.kind === "link" ? `${hint.label}. ${hint.note}` : "";

  return (
    <form className="link-form" onSubmit={handleSubmit} noValidate>
      <div className="link-form-main">
        <label htmlFor={urlId} className="field-label">
          Video link
        </label>
        <div className="paste-row">
          <input
            id={urlId}
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
              setError(null);
            }}
            aria-describedby={`${hintId} ${errorId}`}
            aria-invalid={error !== null}
            className="field-input"
          />
          <button type="submit" className="btn btn-primary">
            Transcribe
          </button>
        </div>
        <p id={hintId} className="field-hint">
          {hintText}
        </p>
        <p id={errorId} className="field-error" role={error === null ? undefined : "alert"}>
          {error ?? ""}
        </p>
      </div>
      <div className="link-form-language">
        <label htmlFor={languageId} className="field-label">
          Language
        </label>
        <select
          id={languageId}
          name="language"
          className="field-select"
          value={language}
          onChange={(event) => setLanguage(event.currentTarget.value)}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
