import Link from "next/link";
import { publicBundle } from "@/lib/content";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  const linkedin = publicBundle.profile.links.find(
    (link) => link.label === "LinkedIn",
  );
  const github = publicBundle.profile.links.find(
    (link) => link.label === "GitHub",
  );
  const wandb = publicBundle.profile.links.find((link) =>
    link.href.includes("wandb.ai"),
  );

  return (
    <footer className={styles.footer}>
      <span className={styles.copyright}>© 2026 Anish Shah</span>
      <nav className={styles.links} aria-label="Public profiles">
        {linkedin ? (
          <a href={linkedin.href} rel="noreferrer" target="_blank">
            LinkedIn
          </a>
        ) : null}
        {github ? (
          <a href={github.href} rel="noreferrer" target="_blank">
            GitHub
          </a>
        ) : null}
        {wandb ? (
          <a href={wandb.href} rel="noreferrer" target="_blank">
            W&amp;B
          </a>
        ) : null}
      </nav>
      <nav className={styles.links} aria-label="Site information">
        <Link href="/sources">Sources</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </footer>
  );
}
