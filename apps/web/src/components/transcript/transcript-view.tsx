import type { Transcription, TranscriptSegment, UncertainSpan } from "../../lib/api/types";
import { formatClock, formatDuration, formatTimestamp, languageName } from "../../lib/format";
import { splitByUncertainty } from "../../lib/transcript/uncertainty";
import {
  contentTypeLabel,
  durationSeconds,
  methodLabel,
  nearestSegmentIndex,
  platformLabel,
  reasonLabel,
  sortedSpans,
  speakerLabel,
  speakerNumbers,
} from "../../lib/transcript/view-model";
import { FlagMark } from "./flag-mark";

interface TranscriptViewProps {
  readonly transcription: Transcription;
  /** `sample` is the compact landing-page example: no review panel. */
  readonly variant?: "full" | "sample";
}

interface StampTarget {
  readonly href: string;
  readonly external: boolean;
}

function stampTarget(index: number): StampTarget {
  return { href: `#seg-${index}`, external: false };
}

/**
 * The transcript, rendered as a reading document. Timestamps link to the segment on this page.
 * Text is never rewritten: uncertain spans are only wrapped for highlighting.
 */
export function TranscriptView({ transcription, variant = "full" }: TranscriptViewProps) {
  const duration = durationSeconds(transcription);
  const numbers = speakerNumbers(transcription.segments);
  const flags = sortedSpans(transcription.uncertain_spans);
  const references = [...transcription.on_screen_references].sort((a, b) => a.at - b.at);
  const title = transcription.metadata.title?.trim() || "Untitled video";
  const author = transcription.metadata.author?.trim() || null;
  const language = languageName(transcription.language);

  const facts = [
    platformLabel(transcription.metadata.platform),
    contentTypeLabel(transcription.metadata.content_type),
    duration > 0 ? formatDuration(duration) : null,
    language,
    methodLabel(transcription.method),
  ].filter((fact): fact is string => fact !== null);

  const hasSegments = transcription.segments.length > 0;
  const headingId = variant === "sample" ? "sample-title" : "transcript-title";

  return (
    <article className={`transcript transcript-${variant}`} aria-labelledby={headingId}>
      <header className="transcript-head">
        <p className="meta-line">{facts.join(" · ")}</p>
        <h2 id={headingId} className="transcript-title">
          {title}
        </h2>
        {author !== null ? <p className="byline">By {author}</p> : null}
      </header>

      {hasSegments ? (
        <ol className="segments" aria-label="Transcript">
          {transcription.segments.map((segment, index) => (
            <SegmentRow
              key={`${index}-${segment.start}`}
              index={index}
              segment={segment}
              previous={index > 0 ? (transcription.segments[index - 1] ?? null) : null}
              duration={duration}
              speakers={numbers}
              flags={flags}
            />
          ))}
        </ol>
      ) : (
        <PlainLines text={transcription.transcript_text} />
      )}

      {variant === "full" ? (
        <ReviewPanel
          flags={flags}
          references={references}
          segments={transcription.segments}
          duration={duration}
        />
      ) : null}
    </article>
  );
}

interface SegmentRowProps {
  readonly index: number;
  readonly segment: TranscriptSegment;
  readonly previous: TranscriptSegment | null;
  readonly duration: number;
  readonly speakers: ReadonlyMap<string, number>;
  readonly flags: readonly UncertainSpan[];
}

function SegmentRow({ index, segment, previous, duration, speakers, flags }: SegmentRowProps) {
  const clock = formatClock(segment.start, duration);
  const target = stampTarget(index);
  const speaker =
    segment.speaker !== null && (previous === null || previous.speaker !== segment.speaker)
      ? speakerLabel(segment.speaker, speakers)
      : null;
  const pieces = splitByUncertainty(segment.text, segment, flags);

  return (
    <li id={`seg-${index}`} className="segment">
      <a
        className="stamp"
        href={target.href}
        {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label={
          target.external
            ? `Open the video at ${clock} in a new tab`
            : `Link to the transcript line at ${clock}`
        }
      >
        {formatTimestamp(segment.start, duration)}
      </a>
      <p className="line">
        {speaker !== null ? <span className="speaker">{speaker}</span> : null}
        {pieces.map((piece, pieceIndex) =>
          piece.flag === null ? (
            <span key={pieceIndex}>{piece.text}</span>
          ) : (
            <FlagMark
              key={pieceIndex}
              id={`flag-${index}-${pieceIndex}`}
              text={piece.text}
              reason={piece.flag.reason}
            />
          ),
        )}
      </p>
    </li>
  );
}

function PlainLines({ text }: { readonly text: string }) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <ol className="segments" aria-label="Transcript">
      {lines.map((line, index) => (
        <li key={index} className="segment segment-plain">
          <p className="line">{line}</p>
        </li>
      ))}
    </ol>
  );
}

interface ReviewPanelProps {
  readonly flags: readonly UncertainSpan[];
  readonly references: readonly { readonly at: number; readonly phrase: string }[];
  readonly segments: readonly TranscriptSegment[];
  readonly duration: number;
}

function ReviewPanel({ flags, references, segments, duration }: ReviewPanelProps) {
  return (
    <section className="review" aria-labelledby="review-title">
      <h3 id="review-title" className="review-title">
        Review before you quote
      </h3>

      {flags.length === 0 ? (
        <p className="review-empty">
          Nothing was flagged. Still check names and numbers against the audio before you publish.
        </p>
      ) : (
        <ul className="review-list">
          {flags.map((flag, index) => {
            const segmentIndex = nearestSegmentIndex(segments, flag.start);
            const target = stampTarget(Math.max(0, segmentIndex));
            return (
              <li key={`${flag.start}-${index}`} className="review-item">
                <a
                  className="review-stamp"
                  href={target.href}
                  {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {formatTimestamp(flag.start, duration)}
                </a>{" "}
                <q className="review-text">{flag.text}</q>{" "}
                <span className="review-reason">{reasonLabel(flag.reason)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {references.length > 0 ? (
        <>
          <h3 className="review-title">On screen</h3>
          <p className="review-note">
            The speaker points at something visible, which the audio alone can&apos;t show. Check the video at these
            times.
          </p>
          <ul className="review-list">
            {references.map((reference, index) => {
              const segmentIndex = nearestSegmentIndex(segments, reference.at);
              const target = stampTarget(Math.max(0, segmentIndex));
              return (
                <li key={`${reference.at}-${index}`} className="review-item">
                  <a
                    className="review-stamp"
                    href={target.href}
                    {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {formatTimestamp(reference.at, duration)}
                  </a>
                  <q className="review-text">{reference.phrase}</q>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
