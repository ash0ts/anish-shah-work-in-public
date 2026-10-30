import Link from "next/link";
import { SITE_COPY } from "@/lib/copy";
import styles from "./HomeIntroduction.module.css";
import { HomeWorkOverview } from "./HomeWorkOverview";
import type { HomeWorkArea } from "@/lib/home-presentation";

type HomeIntroductionProps = {
  headline: string;
  summary: string;
  areas: HomeWorkArea[];
};

export function HomeIntroduction({
  headline,
  summary,
  areas,
}: HomeIntroductionProps) {
  return (
    <section
      id="profile"
      className={styles.introduction}
      aria-labelledby="home-title"
    >
      <div className={styles.identity}>
        <p>{SITE_COPY.home["identity-eyebrow"]}</p>
        <h1 id="home-title" aria-label="Anish Shah">
          <span>Anish</span>
          <span>Shah</span>
        </h1>
      <div className={styles.copy}>
        <p className={styles.headline}>{headline}</p>
        <p className={styles.summary}>{summary}</p>
        <Link className={styles.action} href="/work" prefetch={false}>
          {SITE_COPY.home["primary-cta"]} <span aria-hidden="true">↗</span>
        </Link>
      </div>
      </div>
      <HomeWorkOverview areas={areas} />
    </section>
  );
}
