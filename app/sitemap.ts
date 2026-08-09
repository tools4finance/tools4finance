import type { MetadataRoute } from "next";

// See app/robots.ts for the domain-inference reasoning (contact emails on
// tools4finance.com; no confirmed canonical/vercel.json domain in-repo).
const BASE_URL = "https://tools4finance.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // The homepage (app/page.tsx) links to these legacy static marketing
  // pages directly — they are public, unauthenticated, and indexable, so
  // they belong in the sitemap even though they live outside the App
  // Router. /ifrs/app.html is intentionally excluded: it's the actual tool
  // surface (like /aidat), not a marketing page.
  const legacyMarketingPages = [
    "/contact.html",
    "/ifrs/index.html",
    "/bridge/index.html",
    "/graph/index.html",
  ];

  return [
    {
      url: BASE_URL,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    ...legacyMarketingPages.map((path) => ({
      url: `${BASE_URL}${path}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
