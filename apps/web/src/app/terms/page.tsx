import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "../../components/legal-document";
import {
  CONTACT_MAILTO,
  MIN_PAID_AGE,
  OPERATOR_ADDRESS,
  OPERATOR_NAME,
  PADDLE_BUYER_TERMS_URL,
  REFUND_DAYS,
} from "../../lib/legal";
import { CONTACT_EMAIL, SITE_NAME } from "../../lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using MuteScroll's transcription website and API.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of use"
      lede={`These terms apply to the ${SITE_NAME} website, the transcription service, and the API.`}
    >
      <section aria-labelledby="service">
        <h2 id="service">1. What MuteScroll does</h2>
        <p>
          MuteScroll reads a public video link when it can reach it. Other links get the one-time upload path. For a
          link it can reach, the server reads the video with yt-dlp. It uses the video&apos;s own captions when they
          exist. Otherwise it takes the audio and sends that audio to Groq for speech recognition. If the audio cannot
          be fetched, and the video has automatic captions, those captions are used. The server does not sign in. An
          upload is a file you provide (MP4, MOV, WebM, M4A, MP3, or WAV), transcribed from its audio in the same way.
        </p>
        <p>
          MuteScroll returns text only. It does not return the video or audio, and it does not summarize, translate, or
          give advice. Your assistant does that with the text.
        </p>
        <p>MuteScroll does not affiliate with, endorse, or operate any video platform.</p>
      </section>

      <section aria-labelledby="who">
        <h2 id="who">2. Who operates the service</h2>
        <p>
          {SITE_NAME} is operated by {OPERATOR_NAME}, an individual in {OPERATOR_ADDRESS}. Contact:{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. A paid plan is sold by Paddle, the
          merchant of record, under <a href={PADDLE_BUYER_TERMS_URL}>Paddle&apos;s buyer terms</a>. The receipt names
          Paddle. MuteScroll licenses and runs the transcription service.
        </p>
      </section>

      <section aria-labelledby="content">
        <h2 id="content">3. Content you submit</h2>
        <p>
          You decide which link or file to send. You are responsible for having the authority to use it, and for
          complying with the terms of the place the video lives. By submitting a link or a file you confirm that you
          have that right. MuteScroll may refuse a job, remove a cached transcript, and suspend an account.
        </p>
        <p>
          We do not sign in to a video platform. We do not take private, login-only, DRM-protected, or paywalled videos,
          and you must not ask us to.
        </p>
        <p>
          You keep your file. You give us a limited licence to process the link or the file only to produce the
          transcript, to show it to you, and to keep it for the retention period in the{" "}
          <Link href="/privacy">privacy page</Link>. We do not use your media, uploads, or transcripts to train models.
          We do not claim the copyright in someone else&apos;s video or in the words spoken in it.
        </p>
      </section>

      <section aria-labelledby="use">
        <h2 id="use">4. Acceptable use</h2>
        <ul>
          <li>Do not try to bypass logins, bot checks, rate limits, or other access controls.</li>
          <li>Do not automate requests beyond what the published API allows.</li>
          <li>Do not redistribute media, or publish transcripts of content you do not have the right to publish.</li>
          <li>Do not share an API key, or use the API to resell transcription as your own service.</li>
        </ul>
      </section>

      <section aria-labelledby="accuracy">
        <h2 id="accuracy">5. Accuracy</h2>
        <p>
          Transcripts are produced by automated speech recognition. They can contain errors. Uncertain words are flagged.
          Check names, numbers, and quotes against the audio before you rely on them or publish them. A transcript is not
          professional, legal, or medical advice.
        </p>
      </section>

      <section aria-labelledby="accounts">
        <h2 id="accounts">6. Accounts</h2>
        <p>
          You can open an account with an email address and a password, or with Google. You are responsible for activity
          under that account. Paid use is for people aged {MIN_PAID_AGE} or over. You can delete the account on the{" "}
          <Link href="/account">account page</Link>. That removes the account, its transcripts, its keys, and its
          connected apps. Credit-usage rows stay, as the <Link href="/privacy">privacy page</Link> describes. You can
          also ask by email, and we complete that request within 30 days.
        </p>
      </section>

      <section aria-labelledby="credits">
        <h2 id="credits">7. Credits, plans, and tax</h2>
        <p>
          Anonymous use is 5 credits in a rolling 24 hours. A signed-in account has the monthly allowance for its plan.
          That allowance resets at the start of the next calendar month, in UTC. Unused credits do not roll over. One
          credit covers up to 10 minutes of audio. Each started 10 minutes costs one credit. A job that fails does not
          use a credit. Credit packs are not sold.
        </p>
        <p>
          The prices on the <Link href="/pricing">pricing page</Link> are catalog prices in US dollars. They do not
          include VAT or sales tax. A signed-in person starts checkout on this website. Paddle adds the tax for your
          country at checkout and shows the total before you pay.
        </p>
      </section>

      <section aria-labelledby="billing">
        <h2 id="billing">8. Cancellation and refunds</h2>
        <p>
          You can cancel a paid plan in the Paddle portal linked from your receipt. Cancellation stops the next charge.
          Access continues until the end of the period you have already paid for. You can ask for a refund of the last
          payment within {REFUND_DAYS} days of that payment, and we will approve it in Paddle. The{" "}
          <Link href="/refunds">refunds page</Link> is the full rule, including the separate statutory withdrawal right
          that Paddle provides to consumers in the EU, the EEA, and the UK.
        </p>
      </section>

      <section aria-labelledby="takedown">
        <h2 id="takedown">9. Reports and takedown</h2>
        <p>
          If you believe a transcript should be removed, email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with the
          link, why you believe it should come down, and how we can reach you. The same path is on the{" "}
          <Link href="/privacy#report">privacy page</Link>. We remove cached results for that link and reply.
        </p>
      </section>

      <section aria-labelledby="availability">
        <h2 id="availability">10. Availability and suspension</h2>
        <p>
          The service is provided while it is in early access. MuteScroll reads a public video link when it can reach
          it. Some hosts refuse retrieval, and retrieval success is not guaranteed. Other links get the one-time upload
          path. We may suspend an account that breaks these terms.
          We will tell you when we do, unless we have to stop an active attack first.
        </p>
      </section>

      <section aria-labelledby="liability">
        <h2 id="liability">11. Liability</h2>
        <p>
          If you are a consumer in the European Union, you keep the rights the law
          gives you, including a digital service that matches the description we publish. Nothing in these terms limits
          liability for fraud, for death or personal injury caused by negligence, or for any other liability the law
          says cannot be limited.
        </p>
        <p>
          For other claims, and for customers who use MuteScroll for a business, our total liability arising in a period
          of 12 months is limited to the amount paid for your MuteScroll plan during the 3 months before the claim. We
          are not liable for lost profits, or for a decision you take from a transcript.
        </p>
      </section>

      <section aria-labelledby="law">
        <h2 id="law">12. Law and changes</h2>
        <p>
          MuteScroll is offered worldwide. The operator is established in {OPERATOR_ADDRESS}. If you are a consumer, you keep
          the mandatory consumer rights of the country where you live, and you may bring a claim in the courts of that
          country. If you use MuteScroll for a business, these terms are governed by the laws of Greece, and the courts
          of Athens hear the claim, except where a mandatory rule in your country requires a different court. The
          operator's Greek tax registration is described on the <Link href="/legal">legal notice</Link>.
        </p>
        <p>
          We may update these terms. We will post the new version here before it takes effect. If you have an account and
          the change affects a paid plan, we will email you.
        </p>
      </section>
    </LegalDocument>
  );
}
