"use client";

import "./globals.css";

export default function GlobalError({ reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="container page status-page" role="alert">
          <p className="kicker">Something broke</p>
          <h1 className="display-small">MuteScroll couldn&apos;t load</h1>
          <p className="section-lede">Try again in a moment.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => reset()}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
