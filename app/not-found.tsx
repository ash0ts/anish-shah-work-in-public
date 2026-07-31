import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The requested page is not part of Anish Shah’s public site.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <p className={styles.code}>404 · Not in the public index</p>
      <h1>This path stops here.</h1>
      <p>
        The page may have moved, or it may never have been part of the public
        archive. The work index keeps current and legacy records discoverable.
      </p>
      <nav aria-label="Page not found options">
        <Link href="/work">Explore the work</Link>
        <Link href="/">Return home</Link>
      </nav>
    </main>
  );
}
