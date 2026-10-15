/** Site-wide constants. Public values only: nothing here is a secret. */

export const SITE_NAME = "MuteScroll";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://mutescroll.xyz").replace(/\/+$/, "");

/** MCP endpoint shown to ChatGPT, Claude and Cursor users. Hosted clients need a public https address. */
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || "http://localhost:8080/mcp";

export const CONTACT_EMAIL = "mutescroll.xyz@gmail.com";

/** Quota and length messages link here. Tool-facing copy must not point at /pricing or /checkout. */
export const PLANS_PATH = "/plans";

export const SITE_DESCRIPTION =
  "Paste a public video link. MuteScroll reads it when it can reach it. Other links get the one-time upload path. You get a timestamped transcript you can check, copy, and use in ChatGPT, Claude, or Cursor.";
