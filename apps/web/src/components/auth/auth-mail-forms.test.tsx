// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONFIRM_EMAIL_PATH,
  FORGOT_PASSWORD_PATH,
  INBOX_MESSAGE,
  MAIL_NOT_SENT_MESSAGE,
  RESET_PASSWORD_PATH,
} from "../../lib/auth-mail";
import { AuthForm } from "./auth-form";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";
import { VerifyEmailForm } from "./verify-email-form";

const SAMPLE_TOKEN = "mst_sampletoken";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

describe("login forgot-password link", () => {
  it("links the login form to the reset request and leaves signup alone", () => {
    const { unmount } = render(<AuthForm mode="login" next={undefined} initialError={undefined} connect={undefined} />);
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe("/forgot-password");
    unmount();
    render(<AuthForm mode="signup" next={undefined} initialError={undefined} connect={undefined} />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });
});

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the visitor to check the inbox after a 202 and does not name the address", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(202, { status: "accepted" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "reader@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByRole("status")).textContent).toBe(INBOX_MESSAGE);
    expect(document.body.textContent ?? "").not.toMatch(/reader@example.test|does not exist|no account|we sent/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FORGOT_PASSWORD_PATH);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "reader@example.test" });
  });

  it("shows that mail could not be sent on 503 email_not_configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: { code: "email_not_configured", message: "Email is not configured." } })),
    );
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "reader@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByRole("alert")).textContent).toBe(MAIL_NOT_SENT_MESSAGE);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(INBOX_MESSAGE);
  });

  it("shows an API failure instead of an inbox message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(502, { error: { code: "unavailable", message: "Email could not be sent. Try again in a few minutes." } }),
      ),
    );
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "reader@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email could not be sent. Try again in a few minutes.");
    expect(screen.queryByText(INBOX_MESSAGE)).toBeNull();
  });
});

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not post when the link has no token", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm token={undefined} />);
    expect(screen.getByRole("alert").textContent).toBe("This link is not valid or has expired.");
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the token and new password, without showing the token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(204, undefined));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm token={SAMPLE_TOKEN} />);
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a longer passphrase" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "a longer passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect((await screen.findByRole("status")).textContent).toBe("Your password is updated.");
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESET_PASSWORD_PATH);
    expect(JSON.parse(String(init.body))).toEqual({ token: SAMPLE_TOKEN, password: "a longer passphrase" });
  });

  it("does not post when the two passwords differ", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm token={SAMPLE_TOKEN} />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a longer passphrase" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "a different passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter the same password in both fields.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an expired link and does not say the password changed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: { code: "invalid_request", message: "This link is not valid or has expired." } })),
    );
    render(<ResetPasswordForm token={SAMPLE_TOKEN} />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a longer passphrase" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "a longer passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This link is not valid or has expired.");
    expect(screen.queryByText("Your password is updated.")).toBeNull();
  });
});

describe("VerifyEmailForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms the token from the mail link and does not show it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { email_verified: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VerifyEmailForm token={SAMPLE_TOKEN} />);
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    expect((await screen.findByRole("status")).textContent).toBe("Your email is confirmed.");
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONFIRM_EMAIL_PATH);
    expect(JSON.parse(String(init.body))).toEqual({ token: SAMPLE_TOKEN });
  });

  it("points a missing token at the account page", () => {
    render(<VerifyEmailForm token="" />);
    expect(screen.getByRole("alert").textContent).toBe("This link is not valid or has expired.");
    expect(screen.getByRole("link", { name: "account page" }).getAttribute("href")).toBe("/account");
    expect(screen.queryByRole("button", { name: "Confirm email" })).toBeNull();
  });
});
