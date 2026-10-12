"use client";

import { useState } from "react";

import { formatUsd } from "../../lib/format";
import {
  annualSavingsPercent,
  PLANS,
  priceFor,
  waitlistMailto,
  type Cadence,
  type Plan,
} from "../../lib/pricing";

const CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  monthly: "Monthly",
  annual: "Annual",
};

/** Plan cards with a monthly / annual toggle. Annual is the default, as in PRD 20.4. */
export function PricingPlans() {
  const [cadence, setCadence] = useState<Cadence>("annual");

  return (
    <div className="plans">
      <div className="cadence" role="group" aria-label="Billing period">
        {(["monthly", "annual"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="cadence-option"
            aria-pressed={cadence === option}
            onClick={() => setCadence(option)}
          >
            {CADENCE_LABELS[option]}
          </button>
        ))}
      </div>

      <ul className="plan-grid">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} cadence={cadence} />
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ plan, cadence }: { readonly plan: Plan; readonly cadence: Cadence }) {
  const price = priceFor(plan, cadence);
  const saving = cadence === "annual" ? annualSavingsPercent(plan) : null;
  const isFree = plan.monthlyUsd === 0;
  const cadenceName = cadence === "annual" ? "annual" : "monthly";

  return (
    <li className={plan.recommended ? "plan plan-recommended" : "plan"}>
      <div className="plan-head">
        <h3 className="plan-name">{plan.name}</h3>
        {plan.recommended ? <span className="plan-badge">Recommended</span> : null}
      </div>
      <p className="plan-summary">{plan.summary}</p>

      <p className="plan-price">
        <span className="plan-amount">{isFree ? "$0" : price.amountLabel}</span>
        <span className="plan-period">{isFree ? "forever" : price.period === "year" ? "per year" : "per month"}</span>
      </p>
      <p className="plan-subprice">
        {isFree
          ? "No card needed. Billing isn't live yet."
          : price.perMonthUsd !== null
            ? `${formatUsd(price.perMonthUsd)} per month, billed yearly${saving !== null ? `. Save ${saving}%` : ""}`
            : "Billed monthly."}
      </p>

      <ul className="plan-facts">
        <li>
          <span>Credits</span> {plan.features.credits}
        </li>
        <li>
          <span>Longest video</span> {plan.features.maxLength}
        </li>
        <li>
          <span>Where</span> {plan.features.surfaces}
        </li>
        <li>
          <span>Exports</span> {plan.features.exports}
        </li>
      </ul>

      {isFree ? (
        <p className="plan-cta-note">Anonymous use is open now. Free accounts arrive with sign-up.</p>
      ) : (
        <a
          className={plan.recommended ? "btn btn-primary plan-cta" : "btn plan-cta"}
          href={waitlistMailto(`${plan.name}, ${cadenceName}`, `Please tell me when ${plan.name} (${cadenceName}) is available.`)}
        >
          Join the waitlist
        </a>
      )}
    </li>
  );
}
