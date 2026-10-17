"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CreditsMeter } from "../../../components/account/credits-meter";
import { fetchMe, type Me } from "../../../lib/api/account";

export function SuccessPanel() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const account = await fetchMe(controller.signal);
        if (controller.signal.aborted) return;
        if (!account.ok) {
          setLoadError(account.error.message);
          setMe(null);
          return;
        }
        setMe(account.value);
      } catch {
        if (!controller.signal.aborted) setLoadError("The connection failed. Try again.");
      }
    })();
    return () => controller.abort();
  }, []);

  if (loadError !== "") {
    return (
      <p className="field-error" role="alert">
        {loadError}
      </p>
    );
  }
  if (me === undefined) return <p>Loading the account.</p>;
  if (me === null) {
    return (
      <p>
        <Link href="/login?next=/billing/success">Sign in</Link> to see the plan on this account.
      </p>
    );
  }

  return (
    <section className="usage-card" aria-labelledby="success-plan">
      <p className="kicker">Current plan</p>
      <h2 id="success-plan" className="usage-plan">
        {planLabel(me.plan)}
      </h2>
      <p className="usage-meta">This is the plan already stored for {me.email}.</p>
      <CreditsMeter allowance={me.credits.allowance} used={me.credits.used} bonus={me.credits.bonus} resetsAt={me.credits.resets_at} />
      <p className="usage-meta">{me.credits.remaining} credits remaining.</p>
      <p>
        <Link href="/account">Go to your account</Link>
      </p>
    </section>
  );
}

function planLabel(plan: string): string {
  switch (plan.toLowerCase()) {
    case "free":
      return "Free";
    case "creator":
      return "Creator";
    case "pro":
      return "Pro";
    case "team":
      return "Team";
    default:
      return plan;
  }
}
