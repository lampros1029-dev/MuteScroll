import type { Metadata } from "next";
import Link from "next/link";

import { PricingPlans } from "../../components/pricing/pricing-plans";
import { FoundingCheckout } from "../../components/pricing/checkout-button";
import { formatUsd } from "../../lib/format";
import { TAX_NOTE } from "../../lib/legal";
import { FOUNDING_PASS, PLANS, type PlanFeatures } from "../../lib/pricing";

export const metadata: Metadata = {
  title: "Pricing — timestamped transcripts",
  description: "MuteScroll plans for a timestamped transcript of a public video link. Creator starts at $7.99 a month, or $59 a year.",
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
  { label: "Transcript library", key: "library" },
  { label: "Exports", key: "exports" },
  { label: "Bulk URLs†", key: "bulk" },
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
        <h1 className="display-small">Start small. Upgrade when the month runs out.</h1>
        <p className="section-lede">
          A timestamped transcript of a public video link, or of a file you upload. Monthly and annual are the same
          three paid plans. Annual costs less than twelve monthly payments.
        </p>
      </header>

      <aside className="notice" aria-labelledby="notice-title">
        <h2 id="notice-title" className="notice-title">
          Checkout
        </h2>
        <p>
          A signed-in account continues to Paddle from the plan button. If billing is not open yet, the button says so.{" "}
          {TAX_NOTE} Free anonymous use is available now in the <Link href="/try">transcriber</Link>.
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
        <FoundingCheckout />
      </section>

      <section className="section" aria-labelledby="guarantee-title">
        <h2 id="guarantee-title" className="section-title-small">
          Guarantees
        </h2>
        <ul className="rules">
          <li className="rule">
            <h3 className="rule-title">30-day full refund.</h3>
            <p>
              If a paid plan is not right for you, you get a full refund within 30 days of that payment. The{" "}
              <Link href="/refunds">refunds page</Link> is the rule, including how cancellation works.
            </p>
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
            <strong>1 credit = up to 10 minutes of audio.</strong> Each started 10 minutes costs one credit. A short video
            costs 1 credit, and a 45-minute podcast costs 5.
          </p>
          <p>
            Need more than the monthly allowance? A pack adds 500 credits for $5 or 2,000 for $15. A pack does not change
            the plan. Unused monthly credits do not roll over.
          </p>
        </div>
      </section>

      <section className="section" id="compare" aria-labelledby="compare-title">
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
          † Planned. Frame checks, speaker labels, and bulk URLs ship in later releases. The transcript library is on this
          site. API keys are included with Team. DOCX export is available. The prices in this table are before VAT and
          sales tax.
        </p>
      </section>

      <section className="section" aria-labelledby="pricing-faq-title">
        <h2 id="pricing-faq-title" className="section-title-small">
          Questions
        </h2>
        <div className="faq">
          {PRICING_FAQ.map((item) => (
            <details key={item.question} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema()) }} />
      </section>
    </div>
  );
}

const PRICING_FAQ: ReadonlyArray<{ readonly question: string; readonly answer: string }> = [
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel from the account, and the paid plan stays until the end of the period you already paid for. A payment can be refunded in full within 30 days. The refunds page is the rule.",
  },
  {
    question: "What happens when I use the credits?",
    answer:
      "A new transcription needs credits still on the account. When the monthly allowance is gone, a credit pack adds more and does not change the plan. Unused monthly credits do not roll over.",
  },
  {
    question: "What counts as a credit?",
    answer: "One credit is up to 10 minutes of audio. A short video costs 1 credit. A 45-minute recording costs 5.",
  },
  {
    question: "Should I pay monthly or annually?",
    answer:
      "They are the same plans. Monthly renews each month. Annual is one payment for the year and costs less than twelve monthly payments. An upgrade on the account uses the interval you already pay.",
  },
  {
    question: "Is this for one person or a team?",
    answer:
      "Creator and Pro are for one person. Team includes three seats, a shared library, and REST API keys. An extra seat is $12 a month, on Team only, and it does not replace the plan.",
  },
  {
    question: "Do you offer a discount?",
    answer:
      "Annual billing costs less than paying monthly. The Founding Pass is $79 for 12 months of Pro, for the first 500 members, and that price stays while the subscription stays.",
  },
  {
    question: "What if a transcription fails?",
    answer: "The job fails for free and the credit goes back. A failed job does not use the allowance.",
  },
  {
    question: "Where do card details go?",
    answer:
      "Paddle is the merchant of record and charges the card. MuteScroll does not store the card number or the security code. VAT or sales tax is added for your country at checkout.",
  },
];

function faqSchema(): { "@context": string; "@type": string; mainEntity: { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }[] } {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PRICING_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
