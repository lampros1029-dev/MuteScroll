/** Pending ChatGPT connector request carried on the sign-in URL. */
export interface ConnectRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly state: string;
  readonly scope: string;
  readonly resource: string;
}

export function connectRequestFrom(params: Record<string, string | string[] | undefined>): ConnectRequest | undefined {
  const clientId = one(params["client_id"]);
  const redirectUri = one(params["redirect_uri"]);
  const codeChallenge = one(params["code_challenge"]);
  const state = one(params["state"]);
  if (clientId === "" || redirectUri === "" || codeChallenge === "" || state === "") return undefined;
  const method = one(params["code_challenge_method"]);
  const scope = one(params["scope"]);
  return {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: method === "" ? "S256" : method,
    state,
    scope: scope === "" ? "transcribe" : scope,
    resource: one(params["resource"]),
  };
}

export function connectSearch(connect: ConnectRequest): URLSearchParams {
  const search = new URLSearchParams({
    client_id: connect.clientId,
    redirect_uri: connect.redirectUri,
    code_challenge: connect.codeChallenge,
    code_challenge_method: connect.codeChallengeMethod,
    state: connect.state,
    scope: connect.scope,
  });
  if (connect.resource !== "") search.set("resource", connect.resource);
  return search;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
