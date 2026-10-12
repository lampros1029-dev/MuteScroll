import type { NextConfig } from "next";

/**
 * The browser only ever talks to same-origin `/api/v1/*`. `app/api/[...path]/route.ts` proxies
 * those calls at request time (so it can set X-Forwarded-For from the visitor Railway appended).
 * This rewrite is the fallback, applied after dynamic routes, for an `/api` path that handler
 * does not serve. Rewrites are compiled into the build, so this fallback sees `API_BASE_URL`
 * from `next build`.
 */
const apiBase = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

/** Next's own scripts are inline. Paddle checkout may load script, frames, and connections from these hosts. */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com https://buy.paddle.com https://sandbox-buy.paddle.com",
  "style-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com",
  "img-src 'self' data: blob: https://cdn.paddle.com https://*.paddle.com",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.paddle.com https://*.paddle.com https://buy.paddle.com https://sandbox-buy.paddle.com",
  "frame-src https://cdn.paddle.com https://*.paddle.com https://buy.paddle.com https://sandbox-buy.paddle.com",
  "form-action 'self' https://buy.paddle.com https://sandbox-buy.paddle.com",
].join("; ");

const nextConfig: NextConfig = {
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
