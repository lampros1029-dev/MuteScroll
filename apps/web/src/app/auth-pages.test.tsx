// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ForgotPasswordPage from "./forgot-password/page";
import ResetPasswordPage from "./reset-password/page";
import VerifyEmailPage from "./verify-email/page";

const SAMPLE_TOKEN = "mst_pagesample";

describe("auth mail pages", () => {
  it("renders the forgot-password request", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Forgot password" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });

  it("reads the reset token from the query without printing it", async () => {
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: SAMPLE_TOKEN }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Reset password" })).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
  });

  it("reads the confirmation token from the verify-email query without printing it", async () => {
    render(await VerifyEmailPage({ searchParams: Promise.resolve({ token: SAMPLE_TOKEN }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Confirm email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm email" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(SAMPLE_TOKEN);
  });

  it("explains a confirmation link that has no token", async () => {
    render(await VerifyEmailPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toBe("This link is not valid or has expired.");
    expect(screen.queryByRole("button", { name: "Confirm email" })).toBeNull();
  });
});
