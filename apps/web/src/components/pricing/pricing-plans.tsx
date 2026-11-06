"use client";

import { useEffect, useState } from "react";

import { formatUsd } from "../../lib/format";
import {
  annualSavingsPercent,
  PLANS,
  priceFor,
  type Cadence,
  type Plan,
} from "../../lib/pricing";
import { CheckoutButton, useSignedIn } from "./checkout-button";

const CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  monthly: "Monthly",
  annual: "Annual",
};

/** Last billing-period choice. Missing or unreadable means the first visit: monthly. */
const CADENCE_STORAGE_KEY = "ms_pricing_cadence";

function readStoredCadence(): Cadence | null {
  try {
    const stored = window.localStorage.getItem(CADENCE_STORAGE_KEY);
    if (stored === "monthly" || stored === "annual") return stored;
    return null;
  } catch {
    return null;
  }
}

function writeStoredCadence(cadence: Cadence): void {
  try {
    window.localStorage.setItem(CADENCE_STORAGE_KEY, cadence);
  } catch {
    // Private browsing can block storage. The choice still applies on this page.
  }
}

/** Plan cards with a monthly / annual toggle. A first visit shows monthly. A stored choice is kept. */
export function PricingPlans() {
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const signedIn = useSignedIn();
  const saving = maxAnnualSavings();

  useEffect(() => {
    const stored = readStoredCadence();
    if (stored !== null) setCadence(stored);
  }, []);

  function selectCadence(next: Cadence): void {
    setCadence(next);
    writeStoredCadence(next);
  }

  return (
    <div className="plans">
      <div className="cadence-row">
        <div className="cadence" role="group" aria-label="Billing period">
          {(["monthly", "annual"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="cadence-option"
              aria-pressed={cadence === option}
              onClick={() => selectCadence(option)}
            >
              {CADENCE_LABELS[option]}
            </button>
          ))}
        </div>
        {saving === null ? null : <p className="cadence-save">Annual saves up to {saving}%.</p>}
        <a className="cadence-compare" href="#compare">
          Compare plans
        </a>
      </div>

      <ul className="plan-grid">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} cadence={cadence} signedIn={signedIn} />
        ))}
      </ul>
    </div>
  );
}

function maxAnnualSavings(): number | null {
  let max: number | null = null;
  for (const plan of PLANS) {
    const saving = annualSavingsPercent(plan);
    if (saving !== null && (max === null || saving > max)) max = saving;
  }
  return max;
}

function PlanCard({
  plan,
  cadence,
  signedIn,
}: {
  readonly plan: Plan;
  readonly cadence: Cadence;
  readonly signedIn: boolean;
}) {
  const price = priceFor(plan, cadence);
  const saving = cadence === "annual" ? annualSavingsPercent(plan) : null;
  const isFree = plan.monthlyUsd === 0;

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
          ? "No card needed."
          : price.perMonthUsd !== null
            ? `${formatUsd(price.perMonthUsd)} per month, billed yearly${saving !== null ? `. Save ${saving}%` : ""}`
            : "Billed monthly."}
      </p>
      {isFree ? null : <p className="plan-tax">Plus VAT or sales tax for your country.</p>}

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
        <>
          <p className="plan-cta-note">Anonymous use is open now.</p>
          <a className="btn plan-cta" href="/signup">
            Create a free account
          </a>
        </>
      ) : plan.id === "free" ? null : (
        <CheckoutButton
          plan={plan.id}
          interval={cadence === "annual" ? "year" : "month"}
          className={plan.recommended ? "btn btn-primary plan-cta" : "btn plan-cta"}
          signedIn={signedIn}
        />
      )}
    </li>
  );
}
