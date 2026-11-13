import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

const phases = [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_EXPORT, PHASE_DEVELOPMENT_SERVER];

async function contentSecurityPolicy(phase: string): Promise<string> {
  const rules = await nextConfig(phase).headers?.();
  const header = rules?.[0]?.headers.find((entry) => entry.key === "Content-Security-Policy");
  if (header === undefined) throw new Error("Content-Security-Policy header is missing");
  return header.value;
}

function directive(policy: string, name: string): string {
  const match = policy.split("; ").find((part) => part.startsWith(`${name} `));
  if (match === undefined) throw new Error(`${name} is missing`);
  return match;
}

describe("content security policy", () => {
  it("allows the Umami cloud script and the host that script posts to", async () => {
    for (const phase of phases) {
      const policy = await contentSecurityPolicy(phase);
      const scriptSrc = directive(policy, "script-src");
      const connectSrc = directive(policy, "connect-src");
      expect(scriptSrc).toContain("https://cloud.umami.is");
      expect(connectSrc).toContain("https://cloud.umami.is");
      expect(connectSrc).toContain("https://gateway.umami.is");
      expect(scriptSrc).not.toContain("gateway.umami.is");
      expect(policy).not.toContain("umami.dev");
      expect(policy).not.toContain("*.umami");
    }
  });
});
