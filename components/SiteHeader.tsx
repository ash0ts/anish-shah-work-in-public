import { SITE_COPY } from "@/lib/copy";
import { PrimaryNavigation } from "./PrimaryNavigation";
import styles from "./SiteHeader.module.css";

const navigation = [
  [SITE_COPY.site["header-work"], "/work"],
  [SITE_COPY.site["header-play"], "/play"],
] as const;

export function SiteHeader() {
  const wordmark = SITE_COPY.site["header-wordmark"];
  return (
    <header className={styles.header}>
      <PrimaryNavigation homeLabel={wordmark} items={navigation} />
    </header>
  );
}
