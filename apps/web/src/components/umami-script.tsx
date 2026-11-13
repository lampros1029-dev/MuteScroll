import Script from "next/script";

import { umamiWebsiteId } from "../lib/umami";

/**
 * Cookieless Umami Cloud page views. Omitted unless NEXT_PUBLIC_UMAMI_WEBSITE_ID is a website id.
 * `afterInteractive` is the Script strategy for analytics. `defer` matches Umami's snippet.
 */
export function UmamiScript() {
  const websiteId = umamiWebsiteId(process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID);
  if (websiteId === undefined) return null;
  return <Script defer src="https://cloud.umami.is/script.js" strategy="afterInteractive" data-website-id={websiteId} />;
}
