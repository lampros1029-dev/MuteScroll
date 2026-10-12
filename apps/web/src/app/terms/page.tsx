import type { Metadata } from "next";

import { CONTACT_EMAIL } from "../../lib/site";

export const metadata: Metadata = {
  title: "Terms (draft)",
  description: "The terms for using MuteScroll's transcription website and API. Draft, pending legal review.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <p className="draft-badge">Draft, pending legal review</p>
        <h1 className="display-small">Terms of use</h1>
        <p className="section-lede">
          These terms apply to the MuteScroll website and the transcription service. Last updated 12 October 2026.
        </p>
      </header>

      <section aria-labelledby="service">
        <h2 id="service">1. What MuteScroll does</h2>
        <p>
          MuteScroll turns public video links and files you upload into timestamped text. It returns text only. It does
          not return the video or audio, and it does not summarize, translate or give advice. Your assistant does that
          with the text.
        </p>
      </section>

      <section aria-labelledby="content">
        <h2 id="content">2. Content you submit</h2>
        <p>
          You may only submit content you have the right to process. By submitting a link or a file you confirm that you
          have that right. You are responsible for complying with the terms of the platform where the content lives. We
          never access private, login-only, DRM-protected or paywalled content, and you must not ask us to.
        </p>
      </section>

      <section aria-labelledby="use">
        <h2 id="use">3. Acceptable use</h2>
        <ul>
          <li>Do not try to bypass logins, bot checks, rate limits or other access controls.</li>
          <li>Do not automate requests to the service beyond what the published API allows.</li>
          <li>Do not redistribute media, or publish transcripts of content you do not have the right to publish.</li>
        </ul>
      </section>

      <section aria-labelledby="accuracy">
        <h2 id="accuracy">4. Accuracy</h2>
        <p>
          Transcripts are produced by automated speech recognition. They can contain errors. Uncertain words are flagged.
          Check names, numbers and quotes against the audio before you rely on or publish them. Transcripts are not
          professional, legal or medical advice.
        </p>
      </section>

      <section aria-labelledby="credits">
        <h2 id="credits">5. Limits, credits and failed jobs</h2>
        <p>
          Anonymous use is limited by a rolling allowance. One credit covers up to 10 minutes of audio. A job that fails
          does not use a credit. Plans, prices and limits shown on the pricing page are planned and informational until
          billing opens; we will update these terms before any charge is made.
        </p>
      </section>

      <section aria-labelledby="takedown">
        <h2 id="takedown">6. Takedown requests</h2>
        <p>
          If you believe content has been processed in breach of your rights, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the link. We will remove cached results for that
          link and respond within a reasonable time.
        </p>
      </section>

      <section aria-labelledby="availability">
        <h2 id="availability">7. Availability</h2>
        <p>
          The service is provided as is while it is in early access. Some platforms refuse retrieval at times, and
          retrieval success is not guaranteed. Upload always remains available as an alternative.
        </p>
      </section>

      <section aria-labelledby="liability">
        <h2 id="liability">8. Liability</h2>
        <p>
          [To be completed by counsel. Limitations of liability and warranties must comply with applicable consumer law.]
        </p>
      </section>

      <section aria-labelledby="law">
        <h2 id="law">9. Law and changes</h2>
        <p>
          [Governing law and forum to be confirmed by counsel.] We may update these terms and will post changes here
          before they take effect.
        </p>
      </section>
    </div>
  );
}
