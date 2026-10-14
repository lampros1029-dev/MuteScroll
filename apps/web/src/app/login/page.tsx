import type { Metadata } from "next";

import { AuthForm } from "../../components/auth/auth-form";
import { connectRequestFrom } from "../../lib/connect-query";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your MuteScroll account with Google, ChatGPT, or your email and password.",
  alternates: { canonical: "/login" },
};

interface LoginPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = first(params["next"]);
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">Sign in</h1>
        <p className="section-lede">Use Google, connect ChatGPT, or the email and password for your MuteScroll account.</p>
      </header>
      <AuthForm mode="login" next={next} initialError={first(params["error"])} connect={connectRequestFrom(params)} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
