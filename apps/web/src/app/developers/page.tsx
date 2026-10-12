import type { Metadata } from "next";
import Link from "next/link";

import { CopyButton } from "../../components/copy-button";
import { MCP_URL } from "../../lib/site";

export const metadata: Metadata = {
  title: "Developers",
  description: "Connect MuteScroll to ChatGPT, Claude, or Cursor. OAuth works on every plan. REST API keys are a Team feature.",
  alternates: { canonical: "/developers" },
};

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "mutescroll": {
      "url": ${JSON.stringify(MCP_URL)}
    }
  }
}`;

const CURSOR_CONFIG = `{
  "mcpServers": {
    "mutescroll": {
      "url": ${JSON.stringify(MCP_URL)}
    }
  }
}`;

const TEAM_KEY_CONFIG = `{
  "mcpServers": {
    "mutescroll": {
      "url": ${JSON.stringify(MCP_URL)},
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

export default function DevelopersPage() {
  const restBase = restUrl(MCP_URL);
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Developers</h1>
        <p className="section-lede">
          Any plan connects with OAuth. REST API keys are a Team feature. MuteScroll returns the transcript. Summaries
          and translations stay in the assistant.
        </p>
      </header>

      <section className="section" aria-labelledby="mcp-address">
        <h2 id="mcp-address">MCP address</h2>
        <p className="endpoint-url">
          <code>{MCP_URL}</code>
        </p>
        <CopyButton label="Copy address" value={MCP_URL} className="btn btn-primary" />
        <p>
          The endpoint is stateless Streamable HTTP. Clients send <code>Accept: application/json, text/event-stream</code>{" "}
          and <code>Content-Type: application/json</code>. Tools: <code>transcribe_video</code> and{" "}
          <code>get_transcription</code>.
        </p>
      </section>

      <section className="section" aria-labelledby="chatgpt-setup">
        <h2 id="chatgpt-setup">ChatGPT</h2>
        <ol>
          <li>Open ChatGPT settings and turn on Developer Mode.</li>
          <li>
            Add a custom MCP connector named MuteScroll. Server URL: <code>{MCP_URL}</code>.
          </li>
          <li>
            Set authentication to OAuth. ChatGPT opens MuteScroll so you can sign in and allow the connection. That
            works on every plan. Leave authentication empty only for the anonymous allowance.
          </li>
          <li>Start a new chat, enable the connector, and ask it to transcribe a public link.</li>
          <li>
            If the reply is <code>processing</code> plus a job id, ask ChatGPT to call <code>get_transcription</code> with
            that id.
          </li>
        </ol>
      </section>

      <section className="section" aria-labelledby="claude-setup">
        <h2 id="claude-setup">Claude</h2>
        <p>
          In Claude Desktop, add a custom connector and paste the MCP address, or put this in{" "}
          <code>%APPDATA%\Claude\claude_desktop_config.json</code> on Windows. Quit Claude completely and open it again
          so it reads the file.
        </p>
        <pre className="code-block">
          <code>{CLAUDE_CONFIG}</code>
        </pre>
        <p>
          OAuth uses the same account sign-in as ChatGPT, on every plan. A REST API key is a Team feature. On Team, the
          header below can stand in for OAuth. <code>YOUR_API_KEY</code> is a placeholder.
        </p>
        <pre className="code-block">
          <code>{TEAM_KEY_CONFIG}</code>
        </pre>
      </section>

      <section className="section" aria-labelledby="cursor-setup">
        <h2 id="cursor-setup">Cursor</h2>
        <p>
          Add the server in Settings, then MCP, or put this in <code>.cursor/mcp.json</code> or{" "}
          <code>%USERPROFILE%\.cursor\mcp.json</code>. Reload the MCP server after the file is written.
        </p>
        <pre className="code-block">
          <code>{CURSOR_CONFIG}</code>
        </pre>
        <p>The same OAuth server works on every plan. The Bearer header in the Claude example is the Team key path.</p>
      </section>

      <section className="section" aria-labelledby="rest-setup">
        <h2 id="rest-setup">REST</h2>
        <p>
          The REST API is at <code>{restBase}</code>. This website calls it through same-origin <code>/api/v1</code>. A
          Team API key is sent as <code>Authorization: Bearer</code>. Create and revoke keys on the{" "}
          <Link href="/account">account page</Link>. Checkout, the library, and account deletion are on this site.
        </p>
      </section>
    </div>
  );
}

function restUrl(mcpUrl: string): string {
  try {
    const url = new URL(mcpUrl);
    url.pathname = "/v1";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return mcpUrl;
  }
}
