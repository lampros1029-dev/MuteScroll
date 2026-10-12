"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { exportUrl } from "../../lib/api/client";
import { fetchLibrary, type LibraryItem } from "../../lib/api/account";
import { platformLabel } from "../../lib/transcript/view-model";

export function LibraryPanel() {
  const [items, setItems] = useState<readonly LibraryItem[] | null>(null);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function load(nextOffset: number, signal?: AbortSignal): Promise<void> {
    setPending(true);
    let result: Awaited<ReturnType<typeof fetchLibrary>>;
    try {
      result = await fetchLibrary(nextOffset, signal);
    } catch {
      return;
    }
    if (signal?.aborted) return;
    setPending(false);
    if (!result.ok) {
      if (result.error.status === 401 || result.error.status === 403) {
        setSignedOut(true);
        setItems([]);
        return;
      }
      setError(result.error.message);
      setItems([]);
      return;
    }
    setItems((current) => (nextOffset === 0 ? result.value.items : [...(current ?? []), ...result.value.items]));
    setOffset(nextOffset + result.value.items.length);
    setMore(result.value.items.length > 0 && result.value.items.length >= result.value.limit);
  }

  if (signedOut) {
    return (
      <p>
        <Link href="/login?next=/library">Sign in</Link> to see transcripts saved to your account.
      </p>
    );
  }
  if (items === null && error === "") return <p>Loading your library.</p>;
  if (error !== "" && (items === null || items.length === 0)) {
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    );
  }
  if (items === null || items.length === 0) {
    return (
      <div className="paste">
        <p>No transcripts yet.</p>
        <Link className="btn btn-primary" href="/try">
          Transcribe a video
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="rules">
        {items.map((item) => (
          <li className="rule" key={item.id}>
            <h2 className="rule-title">{item.title === null || item.title === "" ? "Untitled transcript" : item.title}</h2>
            <p>
              {item.platform === null ? "Source not listed" : platformLabel(item.platform)}
              {item.status === "" ? "" : ` · ${item.status}`}
              {item.created_at === "" ? "" : ` · ${formatWhen(item.created_at)}`}
            </p>
            <p className="actions">
              <Link href={`/try?job=${encodeURIComponent(item.id)}`}>Open</Link>
              <a href={exportUrl(item.id, "txt")}>Export TXT</a>
            </p>
          </li>
        ))}
      </ul>
      {more ? (
        <button className="btn" type="button" disabled={pending} onClick={() => void load(offset)}>
          {pending ? "Loading" : "Older transcripts"}
        </button>
      ) : null}
    </>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
