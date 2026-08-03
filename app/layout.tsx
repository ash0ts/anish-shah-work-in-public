import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PreviewEnvironmentNotice } from "@/components/PreviewEnvironmentNotice";
import { runtimeRootMetadata } from "@/lib/server/root-metadata";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return runtimeRootMetadata();
}

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
        <PreviewEnvironmentNotice />
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
