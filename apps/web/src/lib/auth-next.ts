/** Where to go after sign-up or sign-in. `checkout` returns to pricing. Other values must stay on this site. */

export function pathAfterAuth(next: string | undefined): string {
  if (next === undefined || next.trim() === "") return "/account";
  if (next === "checkout") return "/pricing";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/account";
  try {
    const url = new URL(next, "https://mutescroll.xyz");
    if (url.origin !== "https://mutescroll.xyz") return "/account";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/account";
  }
}
