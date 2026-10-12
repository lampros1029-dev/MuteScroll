import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container page status-page">
      <p className="kicker">Error 404</p>
      <h1 className="display-small">We couldn&apos;t find that page</h1>
      <p className="section-lede">The address may be mistyped, or the page may have moved.</p>
      <div className="actions">
        <Link href="/try" className="btn btn-primary">
          Transcribe a video
        </Link>
        <Link href="/" className="btn btn-quiet">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
