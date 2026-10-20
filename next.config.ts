import type { NextConfig } from "next";

// Baseline browser protections for every response. No script CSP: Next.js inlines bootstrap
// scripts; framing, plugins and <base> hijacking are what these headers rule out.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Browsers ignore HSTS over plain http, so this only takes effect once served over HTTPS.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  // Lets verification builds use a separate folder so they don't clobber a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // CSV imports send up to 5,000 validated rows to a server action.
    serverActions: { bodySizeLimit: "3mb" },
    // Asset uploads (video clips up to 200 MB) pass through middleware, which buffers the body.
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
