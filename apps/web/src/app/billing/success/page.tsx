import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Payment received",
  description: "MuteScroll updates the plan after Paddle confirms the payment.",
  robots: { index: false, follow: false },
};

export default function BillingSuccessPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Payment received</h1>
        <p className="section-lede">
          The plan updates after Paddle confirms the payment. This page does not change the plan by itself.
        </p>
      </header>
      <p>
        <Link href="/account">Go to your account</Link>
      </p>
    </div>
  );
}
