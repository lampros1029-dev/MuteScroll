import type { Config } from "../config.js";
import { MemoryBillingLinkStore, type BillingLinkStore } from "./billing-links.js";
import { FakeBillingProvider } from "./fake-provider.js";
import { PaddleClient } from "./paddle-client.js";
import { PaddleBillingProvider } from "./paddle-provider.js";
import type { BillingProvider } from "./provider.js";

/** Paddle when an API key is set; otherwise the in-memory fake. The key is never logged. */
export function createBillingProvider(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  links: BillingLinkStore = new MemoryBillingLinkStore(),
): BillingProvider {
  const { apiKey, apiBaseUrl, webhookSecret, prices } = config.paddle;
  if (apiKey === undefined || apiBaseUrl === undefined) return new FakeBillingProvider();
  return new PaddleBillingProvider(new PaddleClient(apiKey, apiBaseUrl, fetchImpl), webhookSecret, prices, links);
}
