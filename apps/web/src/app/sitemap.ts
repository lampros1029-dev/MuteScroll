import type { MetadataRoute } from "next";

import { SITE_URL } from "../lib/site";

const LAST_MODIFIED = new Date("2026-10-12T00:00:00Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/try`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/pricing`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/plans`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/developers`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/refunds`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/subprocessors`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.2 },
  ];
  return pages;
}
