import type { Metadata } from "next";

import { ResetPasswordForm } from "../../components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Choose a new password for your MuteScroll account.",
  robots: { index: false, follow: false },
};

interface ResetPasswordPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Reset password</h1>
        <p className="section-lede">Choose a new password. This link works once and expires in one hour.</p>
      </header>
      <ResetPasswordForm token={first(params["token"])} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
