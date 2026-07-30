import Link from "next/link";
import { workBuckets, type PublicWorkGroup } from "@/lib/work-groups";
import type { WorkArchiveRecord } from "@/lib/work-index";
import styles from "./StoryTimeMatrix.module.css";

const years = [2021, 2022, 2023, 2024, 2025, 2026, "undated"] as const;

type StoryTimeMatrixProps = {
  records: WorkArchiveRecord[];
  selectedBucket?: string;
  selectedYear?: string;
};

export function StoryTimeMatrix({
  records,
  selectedBucket = "",
  selectedYear = "",
}: StoryTimeMatrixProps) {
  return (
    <section className={styles.section} aria-labelledby="story-time-title">
      <header className={styles.heading}>
        <div>
          <p>Story × Time</p>
          <h2 id="story-time-title">Where the work takes shape.</h2>
        </div>
        <p>
          Each cell counts bodies of work active in that year, plus the public
          forms nested beneath them. Choose a cell to filter the index.
        </p>
      </header>

      <div className={styles.tableFrame}>
        <table>
          <caption>
            Public work groups by editorial body and active year
          </caption>
          <thead>
            <tr>
              <th scope="col">Body of work</th>
              {years.map((year) => (
                <th key={year} scope="col">
                  {year === "undated" ? "Undated" : year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workBuckets.map((bucket) => (
              <tr data-bucket={bucket.id} key={bucket.id}>
                <th scope="row">
                  <strong>{bucket.shortTitle}</strong>
                  <span>{bucket.statement}</span>
                </th>
                {years.map((year) => {
                  const groups = records
                    .filter((record) => record.bucket === bucket.id)
                    .filter((record) => activeInYear(record, year))
                    .sort(representativeSort);
                  const formCount = groups.reduce(
                    (count, group) => count + group.formCount,
                    0,
                  );
                  const representative = groups[0];
                  const yearValue = String(year);
                  const selected =
                    selectedBucket === bucket.id &&
                    selectedYear === yearValue;
                  return (
                    <td
                      className={representative ? undefined : styles.noData}
                      data-year={yearValue}
                      key={yearValue}
                    >
                      {representative ? (
                        <Link
                          aria-current={selected ? "true" : undefined}
                          href={storyTimeHref(bucket.id, yearValue)}
                        >
                          <span>
                            {groups.length}{" "}
                            {groups.length === 1 ? "work" : "works"} ·{" "}
                            {formCount} {formCount === 1 ? "form" : "forms"}
                          </span>
                          <strong>{representative.title}</strong>
                          {groups.length > 1 ? (
                            <small>+{groups.length - 1} in this cell</small>
                          ) : (
                            <small>View in the index</small>
                          )}
                        </Link>
                      ) : (
                        <span className={styles.empty} aria-label="No indexed work">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function activeInYear(
  record: WorkArchiveRecord,
  year: (typeof years)[number],
) {
  if (year === "undated") {
    return record.yearStart === null && record.yearEnd === null;
  }
  const start = record.yearStart ?? record.yearEnd;
  const end = record.yearEnd ?? record.yearStart;
  return start !== null && end !== null && year >= start && year <= end;
}

function representativeSort(
  left: WorkArchiveRecord,
  right: WorkArchiveRecord,
) {
  const leftFeatured = left.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  const rightFeatured = right.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  return (
    leftFeatured - rightFeatured ||
    (right.yearEnd ?? -1) - (left.yearEnd ?? -1) ||
    left.title.localeCompare(right.title)
  );
}

function storyTimeHref(bucket: PublicWorkGroup["bucket"], year: string) {
  const parameters = new URLSearchParams({ bucket, year });
  return `/work?${parameters.toString()}#work-index`;
}
