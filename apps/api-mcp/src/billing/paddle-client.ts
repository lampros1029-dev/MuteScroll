/** Paddle returned a non-success status, or a success body we could not read. The message never includes the response body. */
export class PaddleApiError extends Error {
  constructor(readonly status: number) {
    super("Paddle request failed");
    this.name = "PaddleApiError";
  }
}

export interface PaddleTransaction {
  readonly transactionId: string;
  readonly url: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
}

/**
 * Thin Paddle Billing REST client. Callers choose the host: sandbox when the key contains `sdbx`.
 * This client does not create products, prices, or customers.
 */
export class PaddleClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async createTransaction(input: {
    readonly priceId: string;
    readonly userId: string;
    readonly checkoutNonce: string;
  }): Promise<PaddleTransaction> {
    const response = await this.fetchImpl(`${this.baseUrl}/transactions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [{ price_id: input.priceId, quantity: 1 }],
        custom_data: { user_id: input.userId, checkout_nonce: input.checkoutNonce },
      }),
    });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new PaddleApiError(response.status);
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new PaddleApiError(response.status);
    }
    const data = asRecord(asRecord(payload)?.["data"]);
    const id = data?.["id"];
    if (data === undefined || typeof id !== "string" || id.length === 0) throw new PaddleApiError(response.status);
    const checkoutUrl = asRecord(data["checkout"])?.["url"];
    const customerId = data["customer_id"];
    const subscriptionId = data["subscription_id"];
    return {
      transactionId: id,
      url: typeof checkoutUrl === "string" ? checkoutUrl : null,
      customerId: typeof customerId === "string" ? customerId : null,
      subscriptionId: typeof subscriptionId === "string" ? subscriptionId : null,
    };
  }

  async createPortalSession(customerId: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new PaddleApiError(response.status);
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new PaddleApiError(response.status);
    }
    const data = asRecord(asRecord(payload)?.["data"]);
    const overview = asRecord(asRecord(data?.["urls"])?.["general"])?.["overview"];
    if (typeof overview !== "string" || !overview.startsWith("https://")) throw new PaddleApiError(response.status);
    return overview;
  }

  /** 409 means Paddle already cancelled the subscription, which is the state we want. */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ effective_from: "immediately" }),
    });
    if (response.status === 409) {
      await response.arrayBuffer().catch(() => undefined);
      return;
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new PaddleApiError(response.status);
    }
    await response.arrayBuffer().catch(() => undefined);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
