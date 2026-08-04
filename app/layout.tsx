import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PreviewEnvironmentNotice } from "@/components/PreviewEnvironmentNotice";
import { ExperienceAudioProvider } from "@/components/experience-audio/ExperienceAudioProvider";
import { runtimeRootMetadata } from "@/lib/server/root-metadata";
import { SITE_COPY } from "@/lib/copy";
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
        <ExperienceAudioProvider>
          <PreviewEnvironmentNotice />
          <a className="skip-link" href="#main">
            {SITE_COPY.site["skip-link"]}
          </a>
          <SiteHeader />
          <div className="site-frame">
            {children}
            <SiteFooter />
          </div>
        </ExperienceAudioProvider>
      </body>
    </html>
  );
}
