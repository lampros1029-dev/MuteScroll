import Link from "next/link";
import type { ReactNode } from "react";

import type { FailureView } from "../../lib/api/errors";
import { LinkifiedText } from "../linkified-text";

interface WorkingPanelProps {
  readonly title: string;
  readonly detail: string;
  /** Pre-formatted elapsed time, e.g. "0:42". Omitted while the request is still being sent. */
  readonly elapsed?: string;
  /** 0..1 while uploading. Omit for the indeterminate bar used while the server works. */
  readonly progress?: number;
  readonly progressLabel?: string;
  readonly children?: ReactNode;
}

export function WorkingPanel({ title, detail, elapsed, progress, progressLabel, children }: WorkingPanelProps) {
  const percent = progress === undefined ? null : Math.round(progress * 100);
  return (
    <section className="panel panel-working" aria-labelledby="working-title">
      <h2 id="working-title" className="panel-title">
        {title}
      </h2>
      <p className="panel-lede" role="status">
        {detail}
      </p>
      {progress === undefined ? (
        <div className="bar bar-indeterminate" aria-hidden="true">
          <span className="bar-fill" />
        </div>
      ) : (
        <progress className="bar-progress" value={progress} max={1} aria-label={progressLabel ?? "Upload progress"} />
      )}
      {percent !== null || elapsed !== undefined ? (
        <p className="panel-meta">
          {percent !== null ? `${percent}% sent` : null}
          {percent !== null && elapsed !== undefined ? " · " : null}
          {elapsed !== undefined ? `Elapsed ${elapsed}` : null}
        </p>
      ) : null}
      {children}
    </section>
  );
}

interface FailurePanelProps {
  readonly view: FailureView;
  readonly onRetry?: () => void;
}

export function FailurePanel({ view, onRetry }: FailurePanelProps) {
  return (
    <section className="panel panel-error" aria-labelledby="failure-title">
      <h2 id="failure-title" className="panel-title">
        {view.title}
      </h2>
      <p className="panel-lede" role="alert">
        <LinkifiedText text={view.message} />
      </p>
      <p className="panel-next">
        {view.nextStep}
        {view.link !== null ? (
          <>
            {" "}
            <Link href={view.link.href}>{view.link.label}</Link>
          </>
        ) : null}
      </p>
      {view.retryable && onRetry !== undefined ? (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface TimeoutPanelProps {
  readonly onCheckAgain: () => void;
}

export function TimeoutPanel({ onCheckAgain }: TimeoutPanelProps) {
  return (
    <section className="panel panel-working" aria-labelledby="timeout-title">
      <h2 id="timeout-title" className="panel-title">
        Still working on it
      </h2>
      <p className="panel-lede" role="status">
        We stopped checking after 10 minutes. The job may still be running on our side.
      </p>
      <p className="panel-next">
        If it fails, nothing is charged. This page&apos;s address points at the same job, so you can come back to it.
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onCheckAgain}>
          Check again
        </button>
      </div>
    </section>
  );
}
