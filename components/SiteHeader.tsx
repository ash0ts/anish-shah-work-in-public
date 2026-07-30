import Link from "next/link";
import styles from "./SiteHeader.module.css";

const navigation = [
  ["Work", "/work"],
  ["About", "/about"],
  ["Play", "/play"],
] as const;

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/" aria-label="Anish Shah, home">
        Anish Shah
      </Link>
      <nav className={styles.navigation} aria-label="Primary navigation">
        {navigation.map(([label, href]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
