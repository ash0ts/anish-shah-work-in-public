import Link from "next/link";
import { SITE_COPY } from "@/lib/copy";
import styles from "./SiteHeader.module.css";

const navigation = [
  [SITE_COPY.site["header-work"], "/work"],
  [SITE_COPY.site["header-play"], "/play"],
] as const;

export function SiteHeader() {
  const wordmark = SITE_COPY.site["header-wordmark"];
  return (
    <header className={styles.header}>
      <Link
        className={styles.wordmark}
        href="/"
        aria-label={`${wordmark}, home`}
        prefetch={false}
      >
        {wordmark}
      </Link>
      <nav className={styles.navigation} aria-label="Primary navigation">
        {navigation.map(([label, href]) => (
          <Link key={href} href={href} prefetch={false}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
