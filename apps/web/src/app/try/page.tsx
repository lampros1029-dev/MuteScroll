import type { Metadata } from "next";

import { TryClient } from "../../components/try/try-client";
import { normalizeLink } from "../../lib/platform";

export const metadata: Metadata = {
  title: "Transcribe a video",
  description:
    "Paste a public video link or upload a file to get a timestamped transcript with flagged uncertain words.",
  alternates: { canonical: "/try" },
};

interface TryPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function TryPage({ searchParams }: TryPageProps) {
  const params = await searchParams;
  const rawUrl = first(params["url"]);
  const rawJob = first(params["job"]);
  const initialUrl = rawUrl === undefined ? undefined : (normalizeLink(rawUrl) ?? rawUrl);
  const initialJobId = rawJob === undefined ? undefined : rawJob.trim();

  return (
    <div className="container page try-page">
      <header className="page-head">
        <h1 className="display-small">Transcribe a video</h1>
        <p className="section-lede">
          Paste a link to a public video, or upload a file. You get a timestamped transcript, with uncertain words
          flagged, that you can copy or export.
        </p>
      </header>
      <TryClient initialUrl={initialUrl} initialJobId={initialJobId} />
    </div>
  );
}
