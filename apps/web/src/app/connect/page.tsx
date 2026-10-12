import type { Metadata } from "next";

import { ConnectForm, type ConnectQuery } from "./connect-form";

export const metadata: Metadata = {
  title: "Connect ChatGPT",
  description: "Sign in to MuteScroll and allow ChatGPT to transcribe as your account.",
  robots: { index: false, follow: false },
};

interface ConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const params = await searchParams;
  const query: ConnectQuery = {
    clientId: one(params["client_id"]),
    redirectUri: one(params["redirect_uri"]),
    codeChallenge: one(params["code_challenge"]),
    codeChallengeMethod: one(params["code_challenge_method"]),
    state: one(params["state"]),
    scope: one(params["scope"]),
    resource: one(params["resource"]),
  };
  return <ConnectForm query={query} />;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
