import type { Metadata } from "next";

import { AccountPanel } from "./account-panel";

export const metadata: Metadata = {
  title: "Account",
  description: "Your MuteScroll plan, credits, API keys, and connected apps.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <div className="container page">
      <header className="page-head">
        <h1 className="display-small">Account</h1>
        <p className="section-lede">Plan, credits, API keys, and connected apps for the signed-in account.</p>
      </header>
      <AccountPanel />
    </div>
  );
}
