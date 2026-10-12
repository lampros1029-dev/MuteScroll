"use client";

import { useId, useState, type DragEvent } from "react";

import { ACCEPT_ATTRIBUTE, ACCEPTED_LABEL, checkUploadFile } from "../../lib/upload";

interface UploadBoxProps {
  readonly heading: string;
  readonly description: string;
  readonly onFile: (file: File) => void;
}

/** Drag-and-drop or picker for a raw upload (POST /uploads). Validation is instant; the server decides. */
export function UploadBox({ heading, description, onFile }: UploadBoxProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const headingId = useId();
  const errorId = useId();

  function accept(file: File | undefined) {
    if (file === undefined) return;
    const check = checkUploadFile(file);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    onFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  return (
    <section className="upload" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title-small">
        {heading}
      </h2>
      <p className="upload-description">{description}</p>
      <div
        className={dragging ? "dropzone is-dragging" : "dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          id={inputId}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="file-input"
          aria-describedby={errorId}
          onChange={(event) => {
            accept(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <label htmlFor={inputId} className="dropzone-label">
          <span className="dropzone-action">Choose a file</span>
          <span className="dropzone-or">or drop it here</span>
          <span className="dropzone-types">{ACCEPTED_LABEL}</span>
        </label>
      </div>
      <p id={errorId} className="field-error" role={error === null ? undefined : "alert"}>
        {error ?? ""}
      </p>
    </section>
  );
}
