import type { Metadata } from "next";

import { AuthForm } from "../../components/auth/auth-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a MuteScroll account with your email and a password.",
  alternates: { canonical: "/signup" },
};

interface SignupPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const next = first(params["next"]);
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Create account</h1>
        <p className="section-lede">Use your email and a password of at least 10 characters.</p>
      </header>
      <AuthForm mode="signup" next={next} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
