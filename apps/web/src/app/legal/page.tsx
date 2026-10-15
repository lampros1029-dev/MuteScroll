import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "../../components/legal-document";
import { CONTACT_MAILTO, OPERATOR_ADDRESS, OPERATOR_NAME } from "../../lib/legal";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "../../lib/site";

export const metadata: Metadata = {
  title: "Legal notice",
  description: "Who operates MuteScroll, and how Greek VAT and business registration apply to the operator.",
  alternates: { canonical: "/legal" },
};

export default function LegalNoticePage() {
  return (
    <LegalDocument title="Legal notice" lede={`This is the public identity of the person who operates ${SITE_NAME}.`}>
      <section aria-labelledby="operator">
        <h2 id="operator">Operator</h2>
        <p>
          {SITE_NAME} ({SITE_URL}) is operated by {OPERATOR_NAME}, {OPERATOR_ADDRESS}.
        </p>
        <p>
          The operator is an individual and can take payment for the service. Email:{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. A paid plan is sold by Paddle. Paddle charges and remits the
          buyer's VAT or sales tax. That tax is not Greek VAT charged by the operator.
        </p>
      </section>

      <section aria-labelledby="greece">
        <h2 id="greece">Greek registration and the €10,000 line</h2>
        <p>
          Article 44a of the VAT Code (Law 5144/2024) lets a person established in Greece be exempt from charging Greek
          VAT when their turnover in Greece, without VAT, stays within €10,000 in the current year and in the previous
          year. The exemption can apply from the start of the activity. Crossing €10,000 in the year moves that person
          into the normal VAT regime from the transaction that crosses the line. Decision A.1011/2026 (Government
          Gazette B 304/28 January 2026) sets the procedure.
        </p>
        <p>
          Article 11 of the Tax Procedure Code (Law 5104/2024) is the registration rule. A person who is about to carry
          on a business activity files a commencement declaration in the tax register before the first transaction of
          that activity. Article 21(3) of the Income Tax Code (Law 4172/2013) treats three similar transactions within
          six months as systematic business activity. A paid subscription is that kind of activity, so the commencement
          declaration is due before the first payout, including where the year's turnover will stay under €10,000. The
          €10,000 figure changes the VAT regime after registration. It does not postpone the declaration until the
          figure is reached.
        </p>
      </section>

      <section aria-labelledby="platforms">
        <h2 id="platforms">Video hosts</h2>
        <p>
          MuteScroll does not affiliate with, endorse, or operate any video host. MuteScroll reads a public video link
          when it can reach it. Other links get the one-time upload path. A public video link is only the address of a
          video. MuteScroll does not speak for the service that hosts it.
        </p>
      </section>

      <section aria-labelledby="hosting">
        <h2 id="hosting">Hosting</h2>
        <p>The website and the API are hosted on Railway. DNS and HTTPS are provided by Cloudflare.</p>
      </section>

      <section aria-labelledby="related">
        <h2 id="related">Related pages</h2>
        <ul>
          <li>
            <Link href="/terms">Terms of use</Link>
          </li>
          <li>
            <Link href="/privacy">Privacy</Link>
          </li>
          <li>
            <Link href="/refunds">Refunds and cancellation</Link>
          </li>
          <li>
            <Link href="/subprocessors">Subprocessors</Link>
          </li>
        </ul>
      </section>
    </LegalDocument>
  );
}
