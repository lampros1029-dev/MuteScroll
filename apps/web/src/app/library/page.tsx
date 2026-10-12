import type { Metadata } from "next";

import { LibraryPanel } from "./library-panel";

export const metadata: Metadata = {
  title: "Library",
  description: "Transcripts saved to your MuteScroll account.",
  robots: { index: false, follow: false },
};

export default function LibraryPage() {
  return (
    <div className="container page">
      <header className="page-head">
        <h1 className="display-small">Library</h1>
        <p className="section-lede">Transcripts saved to this account.</p>
      </header>
      <LibraryPanel />
    </div>
  );
}
