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
};

/** Copy and export actions for a finished transcript. Export links are plain downloads. */
export function TranscriptToolbar({ transcription, jobId, sourceUrl }: TranscriptToolbarProps) {
  const plainText = buildPlainText(transcription);
  const markdown = buildMarkdown(transcription, { sourceUrl });

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
              <a className="btn btn-quiet" href={exportUrl(jobId, format)} download>
                {FORMAT_LABELS[format]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="toolbar-credits">
        {transcription.credits_charged === 0
          ? "No credits used for this transcript."
          : `${formatCredits(transcription.credits_charged)} used. One credit covers up to 10 minutes of audio.`}
      </p>
    </div>
  );
}
