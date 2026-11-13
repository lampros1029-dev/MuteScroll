import { describe, expect, it, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getConversions } from "../../src/api/attribution-routes.js";
import { MemoryConversionEventStore } from "../../src/attribution/memory-attribution.js";
import type { AppContext } from "../../src/context.js";

describe("attribution admin endpoint", () => {
  let store: MemoryConversionEventStore;
  let mockContext: AppContext;

  beforeEach(() => {
    store = new MemoryConversionEventStore();
    mockContext = {
      config: {
        attributionAdminToken: "test-secret-token",
      },
      stores: {
        conversionEvents: store,
      },
    } as unknown as AppContext;
  });

  const createRequest = (auth: string | undefined, query: URLSearchParams): IncomingMessage => {
    return {
      headers: auth !== undefined ? { authorization: `Bearer ${auth}` } : {},
    } as IncomingMessage;
  };

  const createResponse = (): ServerResponse => {
    let statusCode = 200;
    let body = "";
    const headers: Record<string, string> = {};
    return {
      writeHead(code: number, hdrs?: Record<string, string>) {
        statusCode = code;
        Object.assign(headers, hdrs);
      },
      end(data?: string) {
        body = data ?? "";
      },
      getStatus: () => statusCode,
      getBody: () => body,
      getHeaders: () => headers,
    } as unknown as ServerResponse;
  };

  it("should reject requests without authorization header", async () => {
    const req = createRequest(undefined, new URLSearchParams());
    const res = createResponse();

    await expect(getConversions(req, res, mockContext, new URLSearchParams())).rejects.toThrow();
  });

  it("should reject requests with invalid token", async () => {
    const req = createRequest("wrong-token", new URLSearchParams());
    const res = createResponse();

    await expect(getConversions(req, res, mockContext, new URLSearchParams())).rejects.toThrow();
  });

  it("should reject requests without date range", async () => {
    const req = createRequest("test-secret-token", new URLSearchParams());
    const res = createResponse();

    await expect(getConversions(req, res, mockContext, new URLSearchParams())).rejects.toThrow();
  });

  it("should return empty results for date range with no data", async () => {
    const query = new URLSearchParams({
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    });
    const req = createRequest("test-secret-token", query);
    const res = createResponse();

    await getConversions(req, res, mockContext, query);

    const body = (res as unknown as { getBody: () => string }).getBody();
    const parsed = JSON.parse(body);
    expect(parsed.conversions).toEqual([]);
  });

  it("should return 503 when admin token is not configured", async () => {
    const noTokenContext = {
      ...mockContext,
      config: { attributionAdminToken: undefined },
    } as AppContext;

    const query = new URLSearchParams({
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    });
    const req = createRequest("test-secret-token", query);
    const res = createResponse();

    await expect(getConversions(req, res, noTokenContext, query)).rejects.toThrow();
  });
});
