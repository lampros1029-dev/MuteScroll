import { connectSearch, type ConnectRequest } from "./connect-query";

/**
 * Continue with ChatGPT and Connect with ChatGPT open MuteScroll's connector.
 * An authorization ChatGPT already started lands on the approval screen.
 * Otherwise the person starts on that same page. This is not an OpenAI sign-in URL.
 */
export function chatgptConnectHref(connect: ConnectRequest | undefined): string {
  if (connect === undefined) return "/connect";
  const query = connectSearch(connect).toString();
  return query === "" ? "/connect" : `/connect?${query}`;
}
