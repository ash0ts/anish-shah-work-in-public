import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep canonical/social metadata in the initial head for every visitor.
  // These local lookups share the request publication promise; streaming them
  // into the body adds no useful data-fetch boundary on this SSR-first site.
  // This applies uniformly, not only to crawlers or performance tools.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
