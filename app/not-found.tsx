import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";
import { SITE_COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: SITE_COPY.site["not-found-meta-title"],
  description: SITE_COPY.site["not-found-meta-description"],
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <p className={styles.code}>{SITE_COPY.site["not-found-code"]}</p>
      <h1>{SITE_COPY.site["not-found-title"]}</h1>
      <p>{SITE_COPY.site["not-found-body"]}</p>
      <nav aria-label="Page not found options">
        <Link href="/work">{SITE_COPY.site["not-found-work-cta"]}</Link>
        <Link href="/">{SITE_COPY.site["not-found-home-cta"]}</Link>
      </nav>
    </main>
  );
}
