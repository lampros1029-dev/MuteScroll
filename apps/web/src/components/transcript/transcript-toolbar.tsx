"use client";

import { useState, type MouseEvent } from "react";

import { CopyButton } from "../copy-button";
import { exportUrl } from "../../lib/api/client";
import { EXPORT_FORMATS, type ExportFormat, type Transcription } from "../../lib/api/types";
import { formatCredits } from "../../lib/format";
import { buildMarkdown, buildPlainText } from "../../lib/transcript/markdown";

interface TranscriptToolbarProps {
  readonly transcription: Transcription;
  readonly jobId: string;
  readonly sourceUrl: string | null;
}

const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  txt: "TXT",
  md: "Markdown",
  srt: "SRT",
  vtt: "VTT",
  json: "JSON",
  docx: "DOCX",
};

/** Copy and export actions for a finished transcript. Export links are plain downloads. */
export function TranscriptToolbar({ transcription, jobId, sourceUrl }: TranscriptToolbarProps) {
  const plainText = buildPlainText(transcription);
  const markdown = buildMarkdown(transcription, { sourceUrl });
  const [exportError, setExportError] = useState("");

  async function downloadExport(event: MouseEvent<HTMLAnchorElement>, format: ExportFormat): Promise<void> {
    event.preventDefault();
    setExportError("");
    try {
      const response = await fetch(exportUrl(jobId, format));
      if (!response.ok) {
        setExportError(await exportFailure(response));
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `transcript-${jobId}.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch {
      setExportError("The export did not download. Try again.");
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group" role="group" aria-label="Copy">
        <CopyButton label="Copy as text" value={plainText} />
        <CopyButton label="Copy as Markdown" value={markdown} />
      </div>
      <nav className="toolbar-group" aria-label="Export">
        <span className="toolbar-caption">Export</span>
        <ul className="export-list">
          {EXPORT_FORMATS.map((format) => (
            <li key={format}>
              <a className="btn btn-quiet" href={exportUrl(jobId, format)} download onClick={(event) => void downloadExport(event, format)}>
                {FORMAT_LABELS[format]}
              </a>
            </li>
          ))}
        </ul>
        {exportError === "" ? null : (
          <p className="field-error" role="alert">
            {exportError}
          </p>
        )}
      </nav>
      <p className="toolbar-credits">
        {transcription.credits_charged === 0
          ? "No credits used for this transcript."
          : `${formatCredits(transcription.credits_charged)} used. One credit covers up to 10 minutes of audio.`}
      </p>
    </div>
  );
}

async function exportFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (typeof body.error?.message === "string" && body.error.message !== "") return body.error.message;
  } catch {
    return "This export is not available on the current plan.";
  }
  return "This export is not available on the current plan.";
}
