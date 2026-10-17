"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";

import { CopyButton } from "../../components/copy-button";

type ClientId = "chatgpt" | "claude" | "cursor";

const CLIENTS: readonly { id: ClientId; label: string }[] = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
];

export function DeveloperSetup({ mcpUrl }: { readonly mcpUrl: string }) {
  const [active, setActive] = useState<ClientId>("chatgpt");
  const tabs = useRef<Partial<Record<ClientId, HTMLButtonElement | null>>>({});

  function select(id: ClientId, moveFocus: boolean) {
    setActive(id);
    if (moveFocus) tabs.current[id]?.focus();
  }

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = CLIENTS.findIndex((client) => client.id === active);
    const last = CLIENTS.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    const client = CLIENTS[next];
    if (client) select(client.id, true);
  }

  return (
    <div className="dev-setup">
      <div role="tablist" aria-label="Clients" className="dev-tabs" onKeyDown={onTabsKeyDown}>
        {CLIENTS.map((client) => {
          const selected = client.id === active;
          return (
            <button
              key={client.id}
              ref={(node) => {
                tabs.current[client.id] = node;
              }}
              type="button"
              role="tab"
              id={`dev-tab-${client.id}`}
              className="dev-tab"
              aria-selected={selected}
              aria-controls="dev-client-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(client.id, false)}
            >
              {client.label}
            </button>
          );
        })}
      </div>
      <section role="tabpanel" id="dev-client-panel" aria-labelledby={`dev-tab-${active}`} className="dev-panel">
        <div className="dev-address">
          <h2 id="mcp-address">MCP address</h2>
          <p className="endpoint-url">
            <code>{mcpUrl}</code>
          </p>
          <CopyButton label="Copy address" value={mcpUrl} className="btn btn-primary" />
          <p className="dev-note">The endpoint is stateless Streamable HTTP.</p>
        </div>
        <ClientStep id={active} mcpUrl={mcpUrl} />
      </section>
    </div>
  );
}

function ClientStep({ id, mcpUrl }: { readonly id: ClientId; readonly mcpUrl: string }) {
  switch (id) {
    case "chatgpt":
      return (
        <>
          <p className="dev-step">
            Plugins → Add custom MCP server → <code>{mcpUrl}</code> → OAuth.
          </p>
          <p className="dev-step">
            <Link href="/connect">Continue with ChatGPT</Link>
          </p>
        </>
      );
    case "claude":
      return (
        <p className="dev-step">
          Add a custom connector with <code>{mcpUrl}</code>, then OAuth.
        </p>
      );
    case "cursor":
      return (
        <p className="dev-step">
          Settings → MCP → add a remote server with <code>{mcpUrl}</code>, then OAuth.
        </p>
      );
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}
