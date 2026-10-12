"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createTranscription, fetchJob, uploadFile } from "../../lib/api/client";
import { describeFailure, type FailureView } from "../../lib/api/errors";
import type { Failure, Outcome, Transcription } from "../../lib/api/types";
import { formatDuration } from "../../lib/format";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  pollUntilSettled,
  type PollResult,
} from "../../lib/jobs/poll";
import { normalizeLink } from "../../lib/platform";
import { TranscriptToolbar } from "../transcript/transcript-toolbar";
import { TranscriptView } from "../transcript/transcript-view";

import { LinkForm } from "./link-form";
import { FailurePanel, TimeoutPanel, WorkingPanel } from "./status-panels";
import { UploadBox } from "./upload-box";

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "uploading"; readonly fileName: string; readonly progress: number }
  | { readonly kind: "processing"; readonly jobId: string; readonly startedAt: number; readonly sourceUrl: string | null }
  | { readonly kind: "completed"; readonly jobId: string; readonly transcription: Transcription; readonly sourceUrl: string | null }
  | { readonly kind: "failed"; readonly view: FailureView; readonly sourceUrl: string | null }
  | { readonly kind: "timeout"; readonly jobId: string; readonly sourceUrl: string | null };

export interface TryClientProps {
  /** Pre-filled link, e.g. from the landing page. A valid link starts a transcript straight away. */
  readonly initialUrl?: string;
  /** Resume an existing job (from the address bar) instead of starting a new one. */
  readonly initialJobId?: string;
  /** Overridable for tests; production uses the 3 s cadence from the product spec. */
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
}

const JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const NETWORK_FAILURE: Failure = { status: 0, code: "network_error", message: "" };

function toPollResult(outcome: Outcome): PollResult<Transcription, Failure> {
  switch (outcome.kind) {
    case "processing":
      return { status: "pending" };
    case "completed":
      return { status: "done", value: outcome.transcription };
    case "error": {
      const transient = outcome.failure.status === 0 || outcome.failure.status >= 500;
      return { status: "failed", error: outcome.failure, transient };
    }
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled job outcome: ${String(unreachable)}`);
    }
  }
}

/** Address-bar state: `url` keeps the link, `job` lets a reload or a shared link resume the job. */
function addressFor(jobId: string | null, url: string | null): string {
  const params = new URLSearchParams();
  if (url !== null) params.set("url", url);
  if (jobId !== null) params.set("job", jobId);
  const query = params.toString();
  return query === "" ? "/try" : `/try?${query}`;
}

export function TryClient({
  initialUrl,
  initialJobId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxWaitMs = DEFAULT_POLL_TIMEOUT_MS,
}: TryClientProps) {
  const startingLink = initialUrl === undefined ? null : normalizeLink(initialUrl);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [lastUrl, setLastUrl] = useState(initialUrl ?? "");
  const [lastLanguage, setLastLanguage] = useState("auto");
  const [now, setNow] = useState(0);

  const pollController = useRef<AbortController | null>(null);
  const runCounter = useRef(0);
  const autoStarted = useRef(false);

  const cancelPolling = useCallback(() => {
    pollController.current?.abort();
    pollController.current = null;
  }, []);

  const watchJob = useCallback(
    (jobId: string, sourceUrl: string | null): AbortController => {
      cancelPolling();
      const controller = new AbortController();
      pollController.current = controller;
      const startedAt = Date.now();
      setNow(startedAt);
      setPhase({ kind: "processing", jobId, startedAt, sourceUrl });
      window.history.replaceState(window.history.state, "", addressFor(jobId, sourceUrl));

      const fail = (): void => setPhase({ kind: "failed", view: describeFailure(NETWORK_FAILURE), sourceUrl });

      pollUntilSettled<Transcription, Failure>({
        signal: controller.signal,
        intervalMs: pollIntervalMs,
        timeoutMs: maxWaitMs,
        check: async (signal) => toPollResult(await fetchJob(jobId, { signal })),
      })
        .then((outcome) => {
          if (controller.signal.aborted) return;
          pollController.current = null;
          switch (outcome.kind) {
            case "done":
              setPhase({ kind: "completed", jobId, transcription: outcome.value, sourceUrl });
              return;
            case "failed":
              setPhase({ kind: "failed", view: describeFailure(outcome.error), sourceUrl });
              return;
            case "unreachable":
              fail();
              return;
            case "timeout":
              setPhase({ kind: "timeout", jobId, sourceUrl });
              return;
            case "aborted":
              return;
            default: {
              const unreachable: never = outcome;
              throw new Error(`Unhandled poll outcome: ${String(unreachable)}`);
            }
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) fail();
        });

      return controller;
    },
    [cancelPolling, maxWaitMs, pollIntervalMs],
  );

  /** Applies the first response to a new job (from a link or an upload). */
  const applyStart = useCallback(
    (outcome: Outcome, sourceUrl: string | null) => {
      switch (outcome.kind) {
        case "completed":
          window.history.replaceState(window.history.state, "", addressFor(outcome.jobId, sourceUrl));
          setPhase({ kind: "completed", jobId: outcome.jobId, transcription: outcome.transcription, sourceUrl });
          return;
        case "processing":
          watchJob(outcome.jobId, sourceUrl);
          return;
        case "error":
          setPhase({ kind: "failed", view: describeFailure(outcome.failure), sourceUrl });
          return;
        default: {
          const unreachable: never = outcome;
          throw new Error(`Unhandled start outcome: ${String(unreachable)}`);
        }
      }
    },
    [watchJob],
  );

  const startLink = useCallback(
    async (link: string, language: string) => {
      cancelPolling();
      const run = ++runCounter.current;
      setLastUrl(link);
      setLastLanguage(language);
      setPhase({ kind: "submitting" });
      const outcome = await createTranscription({ url: link, language });
      if (run !== runCounter.current) return;
      applyStart(outcome, link);
    },
    [applyStart, cancelPolling],
  );

  const startUpload = useCallback(
    async (file: File) => {
      cancelPolling();
      const run = ++runCounter.current;
      setPhase({ kind: "uploading", fileName: file.name, progress: 0 });
      let outcome: Outcome;
      try {
        outcome = await uploadFile(file, {
          onProgress: (fraction) => {
            if (run !== runCounter.current) return;
            setPhase((previous) => (previous.kind === "uploading" ? { ...previous, progress: fraction } : previous));
          },
        });
      } catch {
        outcome = { kind: "error", failure: NETWORK_FAILURE };
      }
      if (run !== runCounter.current) return;
      applyStart(outcome, null);
    },
    [applyStart, cancelPolling],
  );

  const reset = useCallback(() => {
    runCounter.current += 1;
    cancelPolling();
    setLastUrl("");
    setPhase({ kind: "idle" });
    window.history.replaceState(window.history.state, "", addressFor(null, null));
  }, [cancelPolling]);

  // Mount: resume a job from the address bar, or start a link passed from the landing page.
  // React StrictMode runs this effect twice in development. Polling is cancelled and restarted by
  // the cleanup, but the submit must run only once, so it is guarded by a ref.
  useEffect(() => {
    if (initialJobId !== undefined && JOB_ID_PATTERN.test(initialJobId)) {
      const controller = watchJob(initialJobId, startingLink);
      return () => controller.abort();
    }
    if (startingLink !== null && !autoStarted.current) {
      autoStarted.current = true;
      void startLink(startingLink, "auto");
    }
    return undefined;
  }, []);

  const processingStart = phase.kind === "processing" ? phase.startedAt : null;
  useEffect(() => {
    if (processingStart === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [processingStart]);

  const elapsed =
    processingStart === null ? undefined : formatDuration(Math.max(0, Math.floor((now - processingStart) / 1000)));

  const linkForm = <LinkForm defaultUrl={lastUrl} onSubmit={(link, language) => void startLink(link, language)} />;

  function renderPhase() {
    switch (phase.kind) {
      case "idle":
        return (
          <>
            {linkForm}
            <section className="support" aria-labelledby="support-title">
              <h2 id="support-title" className="section-title-small">
                What works
              </h2>
              <dl className="support-list">
                <div>
                  <dt>YouTube and Shorts</dt>
                  <dd>Public videos. Captions are used when the video has them, which is the fastest path.</dd>
                </div>
                <div>
                  <dt>Facebook</dt>
                  <dd>Public videos. Private or login-only videos need an upload.</dd>
                </div>
                <div>
                  <dt>TikTok and Instagram</dt>
                  <dd>Public posts, on a best-effort basis. If retrieval fails, upload the file.</dd>
                </div>
                <div>
                  <dt>Uploads</dt>
                  <dd>MP4, MOV, WebM, M4A, MP3 or WAV. Always available as the fallback, within the size limit shown if a file is too big.</dd>
                </div>
              </dl>
            </section>
            <UploadBox
              heading="Or upload a file"
              description="Uploads go through the same pipeline and produce the same output."
              onFile={(file) => void startUpload(file)}
            />
          </>
        );

      case "submitting":
        return <WorkingPanel title="Starting your transcript" detail="Checking the link and queuing the job." />;

      case "uploading":
        return (
          <WorkingPanel
            title="Uploading"
            detail={`Sending ${phase.fileName}. Keep this page open until the upload finishes.`}
            progress={phase.progress}
            progressLabel={`Uploading ${phase.fileName}`}
          />
        );

      case "processing":
        return (
          <WorkingPanel
            title="Transcribing"
            detail="Retrieving the audio and running speech recognition. Platform captions are used when they exist."
            elapsed={elapsed}
          >
            <p className="panel-next">
              Longer videos take longer. If you leave, this page&apos;s address resumes the same job.
            </p>
          </WorkingPanel>
        );

      case "completed":
        return (
          <section className="result" aria-label="Your transcript">
            <p className="result-status" role="status">
              Transcript ready.
            </p>
            <TranscriptToolbar transcription={phase.transcription} jobId={phase.jobId} sourceUrl={phase.sourceUrl} />
            <TranscriptView transcription={phase.transcription} sourceUrl={phase.sourceUrl} />
            <div className="result-footer">
              <p>
                Paste this into ChatGPT, Claude or Cursor and ask for a summary, a translation or the three strongest
                claims. Check any flagged words against the audio first.
              </p>
              <button type="button" className="btn btn-quiet" onClick={reset}>
                Transcribe another video
              </button>
            </div>
          </section>
        );

      case "failed": {
        const retryUrl = phase.sourceUrl;
        return (
          <>
            <FailurePanel
              view={phase.view}
              onRetry={retryUrl === null ? undefined : () => void startLink(retryUrl, lastLanguage)}
            />
            {linkForm}
            <UploadBox
              heading={phase.view.offerUpload ? "Upload the file instead" : "Or upload a file"}
              description="Uploads go through the same pipeline and produce the same output. A failed job never uses credits."
              onFile={(file) => void startUpload(file)}
            />
          </>
        );
      }

      case "timeout": {
        const { jobId, sourceUrl } = phase;
        return <TimeoutPanel onCheckAgain={() => void watchJob(jobId, sourceUrl)} />;
      }

      default: {
        const unreachable: never = phase;
        throw new Error(`Unhandled phase: ${String(unreachable)}`);
      }
    }
  }

  return <div className="try-flow">{renderPhase()}</div>;
}
