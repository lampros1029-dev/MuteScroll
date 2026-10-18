import type { Metadata } from "next";

import { ForgotPasswordForm } from "../../components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a link to reset the password for your MuteScroll account.",
  alternates: { canonical: "/forgot-password" },
};

export default function ForgotPasswordPage() {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Forgot password</h1>
        <p className="section-lede">Enter the email for your MuteScroll account. The reset link expires in one hour.</p>
      </header>
      <ForgotPasswordForm />
    </div>
  );
}
