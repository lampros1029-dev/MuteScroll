import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "../../components/legal-document";
import {
  CONTACT_MAILTO,
  OPERATOR_ADDRESS,
  OPERATOR_NAME,
  PADDLE_PRIVACY_URL,
  SESSION_DAYS,
} from "../../lib/legal";
import { CONTACT_EMAIL, SITE_NAME } from "../../lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How MuteScroll handles the links, uploads, transcripts, accounts, and network data you give us.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy"
      lede="This explains what MuteScroll stores when you transcribe a video or open an account, where it goes, and how long it stays."
    >
      <section aria-labelledby="who">
        <h2 id="who">Who we are</h2>
        <p>
          {SITE_NAME} is operated by {OPERATOR_NAME}, an individual established in {OPERATOR_ADDRESS}. We process personal
          data under the GDPR. Contact: <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. The same name and address are on
          the <Link href="/legal">legal notice</Link>.
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
                <td>To find the video and produce the transcript you asked for.</td>
                <td>With the transcript. Anonymous results: 24 hours.</td>
              </tr>
              <tr>
                <td>Audio taken from the video, or the file you upload</td>
                <td>To run speech recognition when the video's own captions are missing.</td>
                <td>Deleted when the job finishes. Not returned to you, and not shared between users.</td>
              </tr>
              <tr>
                <td>Transcript and basic details (title, author, duration, language)</td>
                <td>To show and export your transcript.</td>
                <td>Anonymous results: 24 hours. Account transcripts: 7 days, and they are deleted when the person deletes the account.</td>
              </tr>
              <tr>
                <td>Email address, password hash, and a Google account link when you use Google</td>
                <td>To create the account and sign you in. A password is stored as a hash. Google sign-in stores the Google account identifier and the email Google provides.</td>
                <td>While the account exists. Deleting the account removes them.</td>
              </tr>
              <tr>
                <td>API keys, and the grant when you connect ChatGPT, Claude, or Cursor</td>
                <td>To let that account call the transcription API.</td>
                <td>While the account exists. Deleting the account removes them.</td>
              </tr>
              <tr>
                <td>Paddle customer, subscription, and transaction ids, and the plan name</td>
                <td>To know which plan the account has. We do not receive or store the card number.</td>
                <td>While the account exists. Deleting the account removes them.</td>
              </tr>
              <tr>
                <td>Network address (IP address)</td>
                <td>To apply the anonymous usage limit and to slow abusive sign-ups and logins.</td>
                <td>The anonymous credit limit keeps it in the running process for up to 24 hours, then it ages out. A restart drops it sooner.</td>
              </tr>
              <tr>
                <td>Server logs</td>
                <td>Security and reliability.</td>
                <td>The application writes a line that does not include the link, the transcript, or the network address. The host keeps those lines. This service does not run its own deletion job for them.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          For a link, the server tries to read a public video on YouTube, Facebook, TikTok, or Instagram with yt-dlp. It
          uses the video's own captions when they exist. Otherwise it takes the audio and sends that audio to Groq. If
          the audio cannot be fetched, and the video has automatic captions, those captions are used. The server does
          not sign in, and it does not use a video-platform account or that account's cookies. If the video cannot be
          read, you can upload a file. An upload is transcribed from its audio.
        </p>
        <p>
          We store the link, the metadata, and the transcript. We do not store the content of your conversations with
          ChatGPT, Claude, or Cursor, and we do not ask for it.
        </p>
        <p>
          We process account and transcript data to provide the service you asked for. We process the network address
          and logs to keep the service secure and to apply the published limits. Paddle, not MuteScroll, keeps the tax
          invoice for a paid plan.
        </p>
      </section>

      <section aria-labelledby="training">
        <h2 id="training">Your content and AI training</h2>
        <p>
          We do not use your media, uploads, or transcripts to train AI models. Your transcript is yours to copy, export,
          and delete.
        </p>
      </section>

      <section aria-labelledby="processors">
        <h2 id="processors">Who processes data for us</h2>
        <p>
          The named list and the country are on the{" "}
          <Link href="/subprocessors">subprocessors page</Link>. In short:
        </p>
        <ul>
          <li>
            <strong>Groq</strong>, in the United States, runs speech-to-text on the audio we send.
          </li>
          <li>
            <strong>Railway</strong> hosts the app and the API.
          </li>
          <li>
            <strong>Cloudflare</strong> provides DNS and HTTPS.
          </li>
          <li>
            <strong>Paddle</strong> is the merchant of record. Paddle processes payments when billing is open. Paddle sells
            the paid plan, handles the card, and is the controller of that payment data under{" "}
            <a href={PADDLE_PRIVACY_URL}>Paddle&apos;s privacy notice</a>.
          </li>
        </ul>
        <p>
          Groq, Railway, Cloudflare, and Paddle process data for MuteScroll. Groq&apos;s data-processing addendum is
          accepted by electronic acceptance of Groq&apos;s services agreement. Zero Data Retention is enabled for
          inference.{" "}
          <a href="https://console.groq.com/docs/your-data">Groq&apos;s published data documentation</a> states that
          customer data that is retained is stored in Google Cloud in the United States, and that customers can rely on
          standard contractual clauses for that transfer. That is Groq&apos;s published position. Paddle is the merchant
          of record. We will update this page when a provider changes.
        </p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies">Cookies</h2>
        <p>
          Signing in sets two cookies. Continue with Google sets a third cookie while that redirect is in progress. They
          are strictly necessary for the account you asked for, so we do not show a consent banner for them.
        </p>
        <ul>
          <li>
            <strong>ms_session</strong> keeps you signed in. The browser hides it from page scripts. It lasts{" "}
            {SESSION_DAYS} days and moves forward when you use the site.
          </li>
          <li>
            <strong>ms_csrf</strong> lets the page prove that a signed-in action came from MuteScroll and not from another
            website. It lasts {SESSION_DAYS} days.
          </li>
          <li>
            <strong>ms_google_tx</strong> ties a Google sign-in redirect to this browser. The browser hides it from page
            scripts. It lasts 10 minutes and is cleared when Google sends you back.
          </li>
        </ul>
        <p>
          We do not use advertising trackers. We do not run third-party analytics on the pages you read. If we add
          product analytics later, this page will say what it measures before it starts.
        </p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">Your rights</h2>
        <p>
          You can delete the account on the account page. That deletes the account, its transcripts, its keys, and its
          connected apps. Credit-usage rows stay. They record an account id, a job id, the credits, and the month. They
          do not record the email, the transcript, or the card number. That ledger does not allow those rows to be
          deleted. You can also ask for a copy of your data, a correction, a restriction, or deletion by emailing{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. You can also object to a use based on our operational needs, and
          you can ask for the account data in a portable form. We complete an email request within 30 days. You can
          complain to your national data protection authority. People in Greece can complain to the Hellenic Data
          Protection Authority.
        </p>
      </section>

      <section aria-labelledby="report">
        <h2 id="report">Report a transcript</h2>
        <p>
          If you own a video, or you believe a stored transcript is illegal, email{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with:
        </p>
        <ul>
          <li>The link, or another way for us to find the exact transcript.</li>
          <li>Why you believe it should be removed.</li>
          <li>Your name and an email address we can reply to.</li>
          <li>A statement that you believe the report is accurate.</li>
        </ul>
        <p>We confirm we received it, remove cached results when the report identifies them, and tell you what we decided.</p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">Changes to this policy</h2>
        <p>We will post changes here and, for material changes, tell registered users by email.</p>
      </section>
    </LegalDocument>
  );
}
