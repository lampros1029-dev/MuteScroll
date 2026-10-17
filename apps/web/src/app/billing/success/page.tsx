import type { Metadata } from "next";

import { SuccessPanel } from "./success-panel";

export const metadata: Metadata = {
  title: "Account",
  description: "The plan and credits already stored for the signed-in MuteScroll account.",
  robots: { index: false, follow: false },
};

export default function BillingSuccessPage() {
  return (
    <div className="container page">
      <header className="page-head">
        <h1 className="display-small">Your account</h1>
        <p className="section-lede">Paddle confirms a payment, then the plan and credits below are the ones on this account.</p>
      </header>
      <SuccessPanel />
    </div>
  );
}
