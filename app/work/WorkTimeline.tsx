import Link from "next/link";
import {
  workArchiveHref,
  type WorkArchiveQuery,
} from "@/lib/work-archive-query";
import { workBuckets } from "@/lib/work-groups";
import type { WorkArchiveRecord } from "@/lib/work-index";
import styles from "./WorkTimeline.module.css";

const years = [2021, 2022, 2023, 2024, 2025, 2026] as const;

type WorkTimelineProps = {
  query: WorkArchiveQuery;
  records: WorkArchiveRecord[];
};

export function WorkTimeline({ query, records }: WorkTimelineProps) {
  const cells = workBuckets.flatMap((bucket) =>
    years.map((year) => {
      const works = records
        .filter((record) => record.bucket === bucket.id)
        .filter((record) => activeInYear(record, year));
      return {
        bucket,
        year,
        works,
      };
    }),
  );
  const maximum = Math.max(
    1,
    ...cells.map((cell) => cell.works.length),
  );

  return (
    <section
      aria-labelledby="work-timeline-title"
      className={styles.section}
    >
      <header className={styles.header}>
        <div>
          <p>Work over time</p>
          <h2 id="work-timeline-title">Four lines, six years.</h2>
        </div>
        <p>
          Each cell shows work active in that year. Color identifies the line;
          a darker shade means more work. Choose a cell to open that slice.
        </p>
      </header>

      <div
        aria-label="Work timeline table. Scroll horizontally to compare years."
        className={styles.frame}
        role="region"
        tabIndex={0}
      >
        <table>
          <caption>
          Projects by line and year, with exact project counts
          </caption>
          <thead>
            <tr>
              <th scope="col">Line of work</th>
              {years.map((year) => (
                <th key={year} scope="col">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workBuckets.map((bucket) => {
              const rowCells = cells.filter(
                (cell) => cell.bucket.id === bucket.id,
              );
              return (
                <tr data-bucket={bucket.id} key={bucket.id}>
                  <th scope="row">
                    <Link
                      prefetch={false}
                      aria-current={
                        query.bucket === bucket.id && !query.year
                          ? "page"
                          : undefined
                      }
                      href={`${workArchiveHref(query, {
                        bucket: bucket.id,
                        page: null,
                        year: null,
                      })}#work-index`}
                    >
                      <strong>{bucket.title}</strong>
                      <span>{bucket.shortTitle}</span>
                    </Link>
                  </th>
                  {rowCells.map(({ works, year }) => {
                    const selected =
                      query.bucket === bucket.id &&
                      query.year === String(year);
                    const density = densityLevel(
                      works.length,
                      maximum,
                    );
                    return (
                      <td
                        data-density={density || undefined}
                        data-year={year}
                        key={year}
                      >
                        {works.length ? (
                          <Link
                            prefetch={false}
                            aria-current={selected ? "page" : undefined}
                            href={`${workArchiveHref(query, {
                              bucket: bucket.id,
                              page: null,
                              year,
                            })}#work-index`}
                          >
                            <strong>{works.length}</strong>
                            <span>
                              {works.length === 1 ? "work" : "works"}
                            </span>
                          </Link>
                        ) : (
                          <span
                            aria-label={`No indexed work in ${year}`}
                            className={styles.empty}
                          >
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.mobileHint}>
        Scroll the calendar horizontally to compare years.
      </p>
    </section>
  );
}

function activeInYear(
  record: WorkArchiveRecord,
  year: (typeof years)[number],
) {
  const start = record.yearStart ?? record.yearEnd;
  const end = record.yearEnd ?? record.yearStart;
  return start !== null && end !== null && year >= start && year <= end;
}

function densityLevel(count: number, maximum: number) {
  if (!count) return 0;
  return Math.max(
    1,
    Math.min(5, Math.ceil(Math.sqrt(count / maximum) * 5)),
  );
}
