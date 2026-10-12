import type { Metadata } from "next";

import { PaddleCheckout } from "./paddle-checkout";

export const metadata: Metadata = {
  title: "Checkout",
  description: "MuteScroll opens the payment form after you start a payment.",
  robots: { index: false, follow: false },
};

interface CheckoutPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const params = await searchParams;
  const transactionId = first(params["_ptxn"]).trim();

  return (
    <div className="container page legal">
      <PaddleCheckout transactionId={transactionId} />
      <header className="page-head">
        <h1 className="display-small">Checkout</h1>
        {transactionId.length === 0 ? (
          <p className="section-lede">This page opens when you start a payment.</p>
        ) : (
          <p className="section-lede">The payment form opens on this page.</p>
        )}
      </header>
    </div>
  );
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
