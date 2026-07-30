import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const siteUrl = process.env.SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: {
    default: "Anish Shah — Applied AI, in public",
    template: "%s — Anish Shah",
  },
  description:
    "An inspectable archive of Anish Shah’s work across applied AI, education, products, and technical communities.",
  openGraph: {
    title: "Anish Shah — Applied AI, in public",
    description:
      "Products, education, open source, and technical communities—with the public work attached.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Anish Shah — Applied AI, in public",
    description:
      "Products, education, open source, and technical communities—with the public work attached.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/recursive-kinetic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <div className="site-frame">
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
