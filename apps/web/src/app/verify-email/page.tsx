import type { Metadata } from "next";

import { VerifyEmailForm } from "../../components/auth/verify-email-form";

export const metadata: Metadata = {
  title: "Confirm email",
  description: "Confirm the email address on your MuteScroll account.",
  robots: { index: false, follow: false },
};

interface VerifyEmailPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Confirm email</h1>
        <p className="section-lede">Open the confirmation link from your inbox, then confirm the address.</p>
      </header>
      <VerifyEmailForm token={first(params["token"])} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
