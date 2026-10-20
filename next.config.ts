import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets verification builds use a separate folder so they don't clobber a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // CSV imports send up to 5,000 validated rows to a server action.
    serverActions: { bodySizeLimit: "3mb" },
    // Asset uploads (video clips up to 200 MB) pass through middleware, which buffers the body.
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
