import type { Metadata } from "next";
import Link from "next/link";

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
          Pick one client. Any plan connects with OAuth. REST API keys are a Team feature. Continue with ChatGPT opens{" "}
          <Link href="/connect">/connect</Link> and is MuteScroll&apos;s own OAuth connector, not an OpenAI identity provider.
          MuteScroll returns timestamped text, confidence flags, and exports. It does not return video frames.
          Summaries, translations, and claim checks stay in the assistant.
        </p>
      </header>
      <DeveloperSetup mcpUrl={MCP_URL} />
    </div>
  );
}
