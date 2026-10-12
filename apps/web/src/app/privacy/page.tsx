import type { Metadata } from "next";

import { CONTACT_EMAIL } from "../../lib/site";

export const metadata: Metadata = {
  title: "Privacy (draft)",
  description: "How MuteScroll handles the links, uploads, transcripts and network data you give us. Draft, pending legal review.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <p className="draft-badge">Draft, pending legal review</p>
        <h1 className="display-small">Privacy</h1>
        <p className="section-lede">
          This explains what MuteScroll stores when you transcribe a video, where it goes, and how long it stays. Last
          updated 12 October 2026.
        </p>
      </header>

      <section aria-labelledby="who">
        <h2 id="who">Who we are</h2>
        <p>
          MuteScroll is operated by [legal entity name, registered address, to be added before launch]. We are based in
          the EU and process personal data under the GDPR. Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section aria-labelledby="what">
        <h2 id="what">What we process</h2>
        <div className="table-scroll" role="region" aria-labelledby="what" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Why</th>
                <th scope="col">How long</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>The link you submit</td>
                <td>To find the video and produce the transcript.</td>
                <td>With the transcript result. Anonymous results: 24 hours.</td>
              </tr>
              <tr>
                <td>Audio taken from the video, or the file you upload</td>
                <td>To run speech recognition.</td>
                <td>Deleted within 24 hours. Never returned to you, never shared between users.</td>
              </tr>
              <tr>
                <td>Transcript and basic details (title, author, duration, language)</td>
                <td>To show and export your transcript.</td>
                <td>Anonymous results: 24 hours. Accounts, when available: while the account is active.</td>
              </tr>
              <tr>
                <td>Network address (IP address)</td>
                <td>To apply anonymous usage limits and prevent abuse.</td>
                <td>Rolling window of 24 hours, then discarded.</td>
              </tr>
              <tr>
                <td>Server logs</td>
                <td>Security and reliability.</td>
                <td>[Retention period to be set before launch.]</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We store the link, the metadata and the transcript. We do not store the content of your conversations with
          ChatGPT, Claude or Cursor, and we do not ask for it.
        </p>
      </section>

      <section aria-labelledby="training">
        <h2 id="training">Your content and AI training</h2>
        <p>
          We do not use your media, uploads or transcripts to train AI models. Your transcript is yours to copy, export
          and delete.
        </p>
      </section>

      <section aria-labelledby="processors">
        <h2 id="processors">Who processes data for us</h2>
        <ul>
          <li>
            <strong>Groq</strong>: speech-to-text. The audio we send is processed to produce the transcript.
          </li>
          <li>
            <strong>ScrapeCreators</strong>: media lookup for TikTok and Instagram links, where that route is enabled.
          </li>
          <li>
            <strong>Hosting provider</strong>: [to be confirmed before launch].
          </li>
        </ul>
        <p>
          We sign data processing agreements with these providers and prefer zero-retention and EU processing where it is
          offered. The list will change when providers change, and we will update this page when it does.
        </p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies">Cookies and tracking</h2>
        <p>
          This website does not set cookies and does not use advertising trackers. We do not run third-party analytics on
          the pages you read. If we add product analytics later, this page will say what it measures before it starts.
        </p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">Your rights</h2>
        <p>
          You can ask us for a copy of your data, correct it, or delete it by emailing us. In-app deletion arrives with
          accounts. Account deletion will remove everything within 30 days. You can also complain to your national data
          protection authority.
        </p>
      </section>

      <section aria-labelledby="takedown">
        <h2 id="takedown">Takedown requests</h2>
        <p>
          If you own a video or the rights to it and want its transcript removed, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the link. We purge cached results for that link.
        </p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">Changes to this policy</h2>
        <p>We will post changes here and, for material changes, tell registered users by email.</p>
      </section>
    </div>
  );
}
