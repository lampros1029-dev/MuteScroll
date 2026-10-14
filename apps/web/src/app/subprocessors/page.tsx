import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "../../components/legal-document";
import { PADDLE_PRIVACY_URL } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "The companies that process data for MuteScroll, and whether a contract is signed.",
  alternates: { canonical: "/subprocessors" },
};

const ROWS: ReadonlyArray<{
  readonly name: string;
  readonly role: string;
  readonly where: string;
  readonly contract: string;
}> = [
  {
    name: "Groq",
    role: "Speech-to-text on the audio we send.",
    where: "United States",
    contract: "Accepted in the Groq console. Zero Data Retention is enabled for inference.",
  },
  {
    name: "ScrapeCreators",
    role: "Media lookup for TikTok and Instagram links, where that route is enabled.",
    where: "To be confirmed before launch",
    contract: "Accepted by signing in to the ScrapeCreators console for mutescroll.xyz@gmail.com.",
  },
  {
    name: "Supadata",
    role: "Vendor captions when the video itself cannot be fetched.",
    where: "To be confirmed before launch",
    contract: "Accepted in the Supadata console. The data-processing agreement applies automatically as part of the Terms.",
  },
  {
    name: "Railway",
    role: "Hosts the website, the API, and the media worker.",
    where: "The region configured for the service",
    contract: "Accepted by signing in to the Railway account that runs the mutescroll project.",
  },
  {
    name: "Cloudflare",
    role: "DNS and HTTPS.",
    where: "Global network",
    contract: "Accepted by signing in to the Cloudflare account for mutescroll.xyz.",
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalDocument
      title="Subprocessors"
      lede="These companies process data so MuteScroll can transcribe a video. The contract column shows whether a data-processing agreement is signed."
    >
      <section aria-labelledby="list">
        <h2 id="list">Processors</h2>
        <div className="table-scroll" role="region" aria-labelledby="list" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">What they do</th>
                <th scope="col">Where</th>
                <th scope="col">Contract</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>{row.where}</td>
                  <td>{row.contract}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="paddle">
        <h2 id="paddle">Paddle</h2>
        <p>
          The contract is accepted through the verified Paddle seller account. Paddle is the merchant of record and the seller on a paid receipt. Paddle handles the card and is the
          controller of that payment data, under <a href={PADDLE_PRIVACY_URL}>Paddle&apos;s privacy notice</a>. MuteScroll
          stores the plan and the Paddle customer, subscription, and transaction ids. MuteScroll does not store the card
          number.
        </p>
        <p>
          See also the <Link href="/privacy">privacy page</Link>.
        </p>
      </section>
    </LegalDocument>
  );
}
