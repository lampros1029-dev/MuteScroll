import Script from "next/script";

import { umamiWebsiteId } from "../lib/umami";

/**
 * Optional Umami Cloud page view. Cookieless, and omitted entirely unless
 * NEXT_PUBLIC_UMAMI_WEBSITE_ID is a website id. No script is shipped when it is unset.
 */
export function UmamiScript() {
  const websiteId = umamiWebsiteId(process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID);
  if (websiteId === undefined) return null;
  return <Script src="https://cloud.umami.is/script.js" strategy="lazyOnload" data-website-id={websiteId} />;
}
