import type { Metadata } from "next";
import Link from "next/link";

import { PricingPlans } from "../../components/pricing/pricing-plans";
import { formatUsd } from "../../lib/format";
import { CREDIT_PACKS, FOUNDING_PASS, PLANS, type PlanFeatures, waitlistMailto } from "../../lib/pricing";

export const metadata: Metadata = {
  title: "Plans and prices",
  description:
    "Planned MuteScroll plans: Free, Creator, Pro and Team / API. Informational only while billing is not live. Join the waitlist.",
  alternates: { canonical: "/pricing" },
};

const COMPARE_ROWS: ReadonlyArray<{
  readonly label: string;
  readonly key: keyof PlanFeatures;
}> = [
  { label: "Credits", key: "credits" },
  { label: "Longest video", key: "maxLength" },
  { label: "Where you can use it", key: "surfaces" },
  { label: "Frame checks†", key: "frameChecks" },
  { label: "Speaker labels†", key: "speakerLabels" },
  { label: "Transcript library†", key: "library" },
  { label: "Exports", key: "exports" },
  { label: "Bulk URLs†", key: "bulk" },
  { label: "Unused credits roll over", key: "rollover" },
  { label: "Seats", key: "seats" },
  { label: "Priority queue and support", key: "priority" },
];

const foundingSaving = (() => {
  const pro = PLANS.find((plan) => plan.id === "pro");
  if (pro === undefined || pro.annualUsd === null) return null;
  return pro.annualUsd - FOUNDING_PASS.priceUsd;
})();

export default function PricingPage() {
  return (
    <div className="container page">
      <header className="page-head">
        <p className="kicker">Pricing</p>
        <h1 className="display-small">Plans and prices</h1>
        <p className="section-lede">
          These are the plans we are planning. Billing is not live yet, so every button here joins the waitlist.
        </p>
      </header>

      <aside className="notice" aria-labelledby="notice-title">
        <h2 id="notice-title" className="notice-title">
          Informational
        </h2>
        <p>
          Nothing is charged on this page. Prices may change before billing opens. Free anonymous use is available now
          in the <Link href="/try">transcriber</Link>.
        </p>
      </aside>

      <section className="section" aria-labelledby="plans-title">
        <h2 id="plans-title" className="section-title-small">
          Choose a plan
        </h2>
        <PricingPlans />
      </section>

      <section className="section founding" aria-labelledby="founding-title">
        <div className="founding-copy">
          <p className="kicker">Founding Pass</p>
          <h2 id="founding-title" className="section-title">
            12 months of Pro for ${FOUNDING_PASS.priceUsd}
          </h2>
          <p className="section-lede">
            For the first {FOUNDING_PASS.seatLimit} members only. Your price stays at ${FOUNDING_PASS.priceUsd} a year for
            as long as you stay subscribed.
            {foundingSaving !== null ? ` That is ${formatUsd(foundingSaving)} less than Pro billed yearly.` : ""}
          </p>
          <ul className="bullets">
            <li>Hook Vault prompt pack for ChatGPT and Claude (planned)</li>
            <li>Founder-only community and roadmap voting (planned)</li>
            <li>Double frame checks for life (planned, once frame checks ship)</li>
          </ul>
        </div>
        <a className="btn btn-primary btn-large" href={waitlistMailto("Founding Pass", "Please hold a Founding Pass for me.")}>
          Join the waitlist for the Founding Pass
        </a>
      </section>

      <section className="section" aria-labelledby="guarantee-title">
        <h2 id="guarantee-title" className="section-title-small">
          Guarantees
        </h2>
        <ul className="rules">
          <li className="rule">
            <h3 className="rule-title">30-day full refund.</h3>
            <p>If a paid plan is not right for you, you get a full refund within 30 days. No questions asked.</p>
          </li>
          <li className="rule">
            <h3 className="rule-title">Failed jobs never use credits.</h3>
            <p>If we cannot transcribe a video, the job fails for free and the credit goes back to your balance.</p>
          </li>
        </ul>
      </section>

      <section className="section" aria-labelledby="credit-title">
        <h2 id="credit-title" className="section-title-small">
          What a credit is
        </h2>
        <div className="credit-grid">
          <p>
            <strong>1 credit = up to 10 minutes of audio.</strong> Each started 10 minutes costs one credit. A Reel costs
            1 credit, and a 45-minute podcast costs 5.
          </p>
          <p>
            Need more? Credit packs: {CREDIT_PACKS.map((pack) => `${pack.credits.toLocaleString("en-US")} credits for ${formatUsd(pack.priceUsd)}`).join(" or ")}. They never expire while you are subscribed.
            Packs are sold on the web only.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="compare-title">
        <h2 id="compare-title" className="section-title-small">
          Compare plans
        </h2>
        <div className="table-scroll" role="region" aria-labelledby="compare-title" tabIndex={0}>
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                {PLANS.map((plan) => (
                  <th scope="col" key={plan.id}>
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Monthly price</th>
                {PLANS.map((plan) => (
                  <td key={plan.id}>{plan.monthlyUsd === 0 ? "$0" : `${formatUsd(plan.monthlyUsd)} / month`}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Annual price</th>
                {PLANS.map((plan) => (
                  <td key={plan.id}>{plan.annualUsd === null ? "Not offered" : `${formatUsd(plan.annualUsd)} / year`}</td>
                ))}
              </tr>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {PLANS.map((plan) => (
                    <td key={plan.id}>{plan.features[row.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          † Planned. Frame checks, speaker labels, library, bulk URLs and API keys ship in later releases (V1.1 to V3).
          DOCX export is planned. EU customers will see VAT-inclusive prices at checkout.
        </p>
      </section>
    </div>
  );
}
