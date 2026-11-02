import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/app/providers";
import { ServiceWorkerRegistration } from "@/components/app/service-worker";
import "@/styles/globals.css";
import "@/styles/app.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-source", display: "swap" });

export const metadata: Metadata = {
  title: { default: "POS by lifistudio", template: "%s · POS by lifistudio" },
  description: "Sistem POS multi-cabang: produk, stok, transaksi, voucher, dan membership.",
  applicationName: "POS by lifistudio",
  appleWebApp: { capable: true, title: "POS", statusBarStyle: "default" },
  icons: { icon: [{ url: "/brand/logo-tile.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/** Terapkan tema tersimpan sebelum paint pertama agar tidak berkedip. */
const themeScript = `try{var t=localStorage.getItem("boardui:theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-background-full font-sans text-text-primary antialiased">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
