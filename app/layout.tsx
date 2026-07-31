import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PUBLIC_SITE_ORIGIN } from "@/lib/site-constants";
import "./globals.css";

const siteUrl =
  process.env.SITE_URL ||
  process.env.PRODUCTION_SITE_URL ||
  PUBLIC_SITE_ORIGIN;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Anish Shah — Applied AI, in public",
    description:
      "Products, education, open source, and technical communities—with the public work attached.",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.png" />
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
