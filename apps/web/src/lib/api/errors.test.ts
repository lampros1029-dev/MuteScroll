import { describe, expect, it } from "vitest";

import { codeFromStatus, describeFailure, isKnownErrorCode } from "./errors";

describe("describeFailure", () => {
  it("prefers the API message and keeps our next step", () => {
    const view = describeFailure({
      status: 400,
      code: "unsupported_url",
      message: "This isn't a supported video link. Paste a public video link, or upload a file.",
    });
    expect(view.title).toBe("This link isn't supported");
    expect(view.message).toContain("public video link");
    expect(view.nextStep).toContain("upload the file");
    expect(view.offerUpload).toBe(false);
  });

  it("offers an upload for retrieval failures and when an upload URL is present", () => {
    const retrieval = describeFailure({ status: 502, code: "retrieval_failed", message: "" });
    expect(retrieval.offerUpload).toBe(true);
    expect(retrieval.retryable).toBe(true);
    expect(retrieval.message).toBe("I couldn't retrieve this video right now.");

    const withLink = describeFailure({ status: 400, code: "invalid_url", message: "", uploadUrl: "https://x/upload/abc" });
    expect(withLink.offerUpload).toBe(true);
  });

  it("points quota and length problems at the plans page", () => {
    const quota = describeFailure({ status: 429, code: "quota_exceeded", message: "Limit reached." });
    expect(quota.link).toEqual({ href: "/plans", label: "See plans and limits" });
    expect(quota.offerUpload).toBe(false);
    expect(describeFailure({ status: 413, code: "too_long", message: "" }).link?.href).toBe("/plans");
  });

  it("never offers a retry for input problems", () => {
    expect(describeFailure({ status: 400, code: "invalid_url", message: "" }).retryable).toBe(false);
  });

  it("maps unknown codes using the HTTP status", () => {
    const tooLarge = describeFailure({ status: 413, code: "something_new", message: "" });
    expect(tooLarge.title).toBe("That file is too large");
    const unsupported = describeFailure({ status: 415, code: "", message: "" });
    expect(unsupported.title).toBe("This file type isn't supported");
    const server = describeFailure({ status: 500, code: "", message: "stack trace here" });
    expect(server.title).toBe("Something went wrong on our side");
    expect(server.message).toBe("stack trace here");
  });

  it("treats a missing HTTP response as a network failure", () => {
    const view = describeFailure({ status: 0, code: "network_error", message: "" });
    expect(view.title).toBe("We couldn't reach the server");
    expect(view.retryable).toBe(true);
  });

  it("caps very long server messages and collapses whitespace", () => {
    const view = describeFailure({ status: 400, code: "invalid_url", message: `  a\n\n${"b".repeat(600)}  ` });
    expect(view.message.length).toBeLessThanOrEqual(400);
    expect(view.message.startsWith("a b")).toBe(true);
  });
});

describe("error code helpers", () => {
  it("recognises known codes only", () => {
    expect(isKnownErrorCode("quota_exceeded")).toBe(true);
    expect(isKnownErrorCode("worker_timeout")).toBe(false);
  });

  it("maps statuses to codes", () => {
    expect(codeFromStatus(0)).toBe("network_error");
    expect(codeFromStatus(402)).toBe("payment_required");
    expect(codeFromStatus(503)).toBe("server_error");
    expect(codeFromStatus(200)).toBe("internal");
  });
});
