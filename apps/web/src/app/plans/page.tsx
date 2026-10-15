import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Limits",
  description:
    "Anonymous MuteScroll use includes 5 credits per rolling 24 hours. One credit covers up to 10 minutes of audio. Paid plans are described on the website.",
  alternates: { canonical: "/plans" },
};

export default function PlansPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Limits</h1>
        <p className="section-lede">
          Anonymous use includes 5 credits per rolling 24 hours. One credit covers up to 10 minutes of audio.
        </p>
      </header>

      <section aria-labelledby="paid-plans">
        <h2 id="paid-plans">Paid plans</h2>
        <p>Paid plans are described on the website.</p>
      </section>
    </div>
  );
}
