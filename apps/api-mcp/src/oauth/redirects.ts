/** Hosts an MCP client may register as an OAuth redirect. Subdomains of these names are included. */
const REDIRECT_HOSTS = ["chatgpt.com", "openai.com", "claude.ai", "anthropic.com", "cursor.com", "cursor.sh"];

/**
 * A redirect is allowed when it is https on a known assistant host, or http on localhost while this
 * server itself is not on https (local tests). Userinfo is rejected so a redirect cannot carry secrets.
 */
export function redirectUriAllowed(uri: string, allowLocalHttp: boolean): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") {
    return allowLocalHttp && (host === "localhost" || host === "127.0.0.1");
  }
  if (url.protocol !== "https:") return false;
  return REDIRECT_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
