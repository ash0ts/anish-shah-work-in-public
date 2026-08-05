import Link from "next/link";
import {
  workGroupPeriodLabel,
  type featuredWorkBucketsFrom,
} from "@/lib/work-groups";
import { SITE_COPY } from "@/lib/copy";
import styles from "./BodiesOfWork.module.css";

type FeaturedBuckets = ReturnType<typeof featuredWorkBucketsFrom>;

export function BodiesOfWork({ buckets }: { buckets: FeaturedBuckets }) {
  return (
    <section
      className={styles.section}
      aria-labelledby="lines-of-work-title"
    >
      <header className={styles.heading}>
        <p>{SITE_COPY.home["selected-eyebrow"]}</p>
        <h2 id="lines-of-work-title">{SITE_COPY.home["selected-heading"]}</h2>
      </header>

      <ol className={styles.lines}>
        {buckets.flatMap((bucket) => {
          const group = bucket.groups[0];
          if (!group) return [];
          return [
            <li data-work-line data-bucket={bucket.id} key={bucket.id}>
              <h3>{bucket.title}</h3>
              <Link href={`/work/${group.slug}`} prefetch={false}>
                <span>{workGroupPeriodLabel(group)} · {group.homeRole}</span>
                <strong>{group.homeTitle}</strong>
                <i aria-hidden="true">↗</i>
              </Link>
            </li>,
          ];
        })}
      </ol>
    </section>
  );
}
