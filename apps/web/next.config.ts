import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";

/**
 * The browser only ever talks to same-origin `/api/v1/*`. `app/api/[...path]/route.ts` proxies
 * those calls at request time (so it can set X-Forwarded-For from the visitor Railway appended).
 * This rewrite is the fallback, applied after dynamic routes, for an `/api` path that handler
 * does not serve. Rewrites are compiled into the build, so this fallback sees `API_BASE_URL`
 * from `next build`.
 */
const apiBase = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

const paddleHosts = "https://cdn.paddle.com https://*.paddle.com";
const paddleCheckoutHosts = `${paddleHosts} https://buy.paddle.com https://sandbox-buy.paddle.com`;

/**
 * React's development runtime calls eval(). Production builds do not.
 * Production phases never receive 'unsafe-eval', even if NODE_ENV was left as development.
 * `next dev` does, and so does any other non-production phase while NODE_ENV is development.
 */
function allowsUnsafeEval(phase: string): boolean {
  if (
    phase === PHASE_PRODUCTION_BUILD ||
    phase === PHASE_PRODUCTION_SERVER ||
    phase === PHASE_EXPORT
  ) {
    return false;
  }
  return phase === PHASE_DEVELOPMENT_SERVER || process.env.NODE_ENV === "development";
}

/** Next's own scripts are inline. Paddle checkout may load script, frames, and connections from these hosts. */
function contentSecurityPolicy(phase: string): string {
  const scriptSrc = allowsUnsafeEval(phase)
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${paddleCheckoutHosts}`
    : `script-src 'self' 'unsafe-inline' ${paddleCheckoutHosts}`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    scriptSrc,
    `style-src 'self' 'unsafe-inline' ${paddleHosts}`,
    `img-src 'self' data: blob: ${paddleHosts}`,
    "font-src 'self' data:",
    `connect-src 'self' ${paddleCheckoutHosts}`,
    `frame-src ${paddleCheckoutHosts}`,
    "form-action 'self' https://buy.paddle.com https://sandbox-buy.paddle.com",
  ].join("; ");
}

export default function nextConfig(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    poweredByHeader: false,
    async rewrites() {
      return {
        fallback: [
          {
            source: "/api/:path*",
            destination: `${apiBase}/:path*`,
          },
        ],
      };
    },
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com")' },
            { key: "Content-Security-Policy", value: contentSecurityPolicy(phase) },
            { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          ],
        },
      ];
    },
  };
}
