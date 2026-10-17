import type { Metadata } from "next";

import { MCP_URL } from "../../lib/site";
import { DeveloperSetup } from "./setup";

export const metadata: Metadata = {
  title: "Developers",
  description: "Connect MuteScroll to ChatGPT, Claude, or Cursor. OAuth works on every plan. REST API keys are a Team feature.",
  alternates: { canonical: "/developers" },
};

export default function DevelopersPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Developers</h1>
        <p className="section-lede">
          Pick one client. Any plan connects with OAuth. REST API keys are a Team feature. MuteScroll returns the
          transcript. Summaries and translations stay in the assistant.
        </p>
      </header>
      <DeveloperSetup mcpUrl={MCP_URL} />
    </div>
  );
}
