import Link from "next/link";
import { publicBundle } from "@/lib/content";
import { SITE_COPY } from "@/lib/copy";
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
      <span className={styles.copyright}>{SITE_COPY.site["footer-copyright"]}</span>
      <nav className={styles.links} aria-label="Public profiles">
        {linkedin ? (
          <a href={linkedin.href} rel="noreferrer" target="_blank">
            {SITE_COPY.site["footer-linkedin"]}
          </a>
        ) : null}
        {github ? (
          <a href={github.href} rel="noreferrer" target="_blank">
            {SITE_COPY.site["footer-github"]}
          </a>
        ) : null}
        {wandb ? (
          <a href={wandb.href} rel="noreferrer" target="_blank">
            {SITE_COPY.site["footer-wandb"]}
          </a>
        ) : null}
      </nav>
      <nav className={styles.links} aria-label="Site information">
        <Link href="/sources">{SITE_COPY.site["footer-sources"]}</Link>
        <Link href="/privacy">{SITE_COPY.site["footer-privacy"]}</Link>
      </nav>
    </footer>
  );
}
