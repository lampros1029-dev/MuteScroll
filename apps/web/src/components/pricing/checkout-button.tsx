"use client";

import { useEffect, useState } from "react";

import { fetchMe, isBillingClosed, openUrl, startCheckout, BILLING_CLOSED_MESSAGE, type CheckoutInterval, type CheckoutPlan } from "../../lib/api/account";

export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchMe(controller.signal);
        if (!controller.signal.aborted) setSignedIn(result.ok && result.value !== null);
      } catch {
        if (!controller.signal.aborted) setSignedIn(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return signedIn;
}

export function CheckoutButton({
  plan,
  interval,
  className,
  signedIn,
}: {
  readonly plan: CheckoutPlan;
  readonly interval: CheckoutInterval;
  readonly className: string;
  readonly signedIn: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!signedIn) {
    return (
      <a className={className} href="/signup?next=checkout">
        Continue
      </a>
    );
  }

  async function checkout(): Promise<void> {
    setPending(true);
    setMessage("");
    const result = await startCheckout(plan, interval);
    setPending(false);
    if (!result.ok) {
      setMessage(isBillingClosed(result.error) ? BILLING_CLOSED_MESSAGE : result.error.message);
      return;
    }
    openUrl(result.value);
  }

  return (
    <>
      <button className={className} type="button" disabled={pending} onClick={() => void checkout()}>
        {pending ? "Opening checkout" : "Continue"}
      </button>
      {message === "" ? null : (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}

export function FoundingCheckout() {
  const signedIn = useSignedIn();
  return <CheckoutButton plan="founding" interval="year" className="btn btn-primary btn-large" signedIn={signedIn} />;
}
