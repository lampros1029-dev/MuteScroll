"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    // Logged to the console only. Error details are never shown to visitors.
    console.error(error);
  }, [error]);

  return (
    <div className="container page status-page" role="alert">
      <p className="kicker">Something broke</p>
      <h1 className="display-small">This page didn&apos;t load</h1>
      <p className="section-lede">
        Try again. If you were transcribing a video, a failed job never uses credits.
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="btn btn-quiet">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
