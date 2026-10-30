import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Header keamanan untuk semua halaman (API memakai secureHeaders Hono sendiri).
 * CSP memakai 'unsafe-inline' untuk skrip karena Next menyisipkan skrip inline dan nonce memaksa semua halaman
 * dirender dinamis (bertentangan dengan Cache Components/PPR) — dikompensasi: tanpa skrip pihak ketiga,
 * object-src none, base-uri/form-action self, frame-ancestors none (ADR-026).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Thumbnail: Cloudinary (res.cloudinary.com) atau URL https eksternal; blob: untuk pratinjau sebelum unggah.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Kamera untuk scan barcode; USB/serial/Bluetooth untuk printer struk (hanya origin ini). Fitur lain dimatikan.
  { key: "Permissions-Policy", value: "camera=(self), usb=(self), serial=(self), bluetooth=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Image Docker ringan: next build menyiapkan server mandiri berisi file yang benar-benar dipakai.
  output: "standalone",
  // Panduan di aplikasi dibaca dari docs/*.md (satu sumber dengan repo).
  outputFileTracingIncludes: { "/panduan/*": ["./docs/PANDUAN-*.md"] },
  cacheComponents: true,
  partialPrefetching: true,
  // Metadata OAuth untuk aplikasi AI (MCP) harus di root domain; dilayani oleh API.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/authorization-server" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/protected-resource" },
    ];
  },
  async headers() {
    return [
      { source: "/((?!api/).*)", headers: securityHeaders },
      {
        // Service worker selalu diambil ulang (update cepat) dan hanya boleh menjalankan skrip sendiri.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
