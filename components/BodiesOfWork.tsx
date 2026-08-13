import Link from "next/link";
import { HomeRailIcon, HomeTopicIcon } from "@/components/HomeVisualIcons";
import type { HomeTopicRail } from "@/lib/home-presentation";
import { SITE_COPY } from "@/lib/copy";
import styles from "./BodiesOfWork.module.css";

export function BodiesOfWork({ rails }: { rails: HomeTopicRail[] }) {
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
        {rails.map((rail) => (
          <li data-work-line data-bucket={rail.id} key={rail.id}>
            <Link className={styles.line} href={rail.href} prefetch={false}>
              <HomeRailIcon className={styles.lineIcon} iconId={rail.iconId} />
              <span>
                <strong>{rail.title}</strong>
                <small>
                  {rail.projectCount}{" "}
                  {rail.projectCount === 1 ? "project" : "projects"}
                </small>
              </span>
              <i aria-hidden="true">↗</i>
            </Link>
            <ul className={styles.topics}>
              {rail.topics.map((topic) => (
                <li key={topic.id}>
                  <Link href={topic.href} prefetch={false}>
                    <HomeTopicIcon
                      className={styles.topicIcon}
                      topicId={topic.id}
                    />
                    <span>{topic.label}</span>
                    <small
                      aria-label={`${topic.count} ${
                        topic.count === 1 ? "project" : "projects"
                      }`}
                    >
                      {topic.count}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
