import type { MetadataRoute } from "next";

// Production domain inferred from contact emails (hello@tools4finance.com,
// demo@tools4finance.com) found in public/contact.html and public/ifrs/app.html.
// No canonical/og:url tag or vercel.json confirms this explicitly — the only
// canonical tag in the repo (public/ifrs/index.html) points at a placeholder
// "ifrsworkbench.example.com" domain, so it was not usable as evidence.
const BASE_URL = "https://tools4finance.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/aidat/", "/login", "/api/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
