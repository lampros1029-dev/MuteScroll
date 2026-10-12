import type { NextConfig } from "next";

/**
 * The browser only ever talks to same-origin `/api/v1/*`. These rewrites forward it to the
 * REST service (docs/rest-api.md), stripping the `/api` prefix. Rewrites are compiled into the
 * build, so `API_BASE_URL` must be set when `next build` runs.
 */
const apiBase = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/:path*`,
      },
    ];
  },
  async redirects() {
    // The API's error copy links to mutescroll.xyz/plans (PRD 13); the pricing page lives at /pricing.
    return [
      {
        source: "/plans",
        destination: "/pricing",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
