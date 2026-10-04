// Global response headers (applied in next.config.ts).
//
// The Content-Security-Policy deliberately has NO script-src/default-src: Next.js needs
// per-request nonces for a working script policy, which requires dynamic rendering of every
// page (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). A
// half-configured script-src would either break the app or be `unsafe-inline` in disguise, so it
// is a documented deployment step. The directives below are safe for Next.js and Supabase and
// close clickjacking, plugin, <base> and form-hijack vectors.
//
// HSTS is not set here: it must only be sent over HTTPS on the final production domain and is
// normally provided by the hosting platform.

export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Legacy equivalent of frame-ancestors for browsers without CSP level 2.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];
