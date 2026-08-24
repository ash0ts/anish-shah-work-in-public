import type { CopyOwnershipReport } from "@/lib/copy-ownership";
import styles from "./studio.module.css";

export function CopyOwnershipSummary({
  report,
}: {
  report: CopyOwnershipReport | null;
}) {
  const retained = report?.records.filter(
    (record) => record.ignoredD1Wording !== null,
  );

  return (
    <section
      className={styles.copyOwnershipPanel}
      aria-labelledby="copy-ownership-title"
    >
      <div className={styles.copyOwnershipIntro}>
        <div>
          <p className={styles.eyebrow}>Copy ownership</p>
          <h3 id="copy-ownership-title">Public copy lives in Git.</h3>
        </div>
        <p>
          The copy deck owns declared page fields and WorkGroup presentation
          wording. Studio still owns visibility, order, caveats, and reviewed
          metric wording.
        </p>
      </div>

      {report ? (
        <>
          <dl className={styles.copyOwnershipStats}>
            <div>
              <dt>WorkGroups</dt>
              <dd>{report.summary.workGroupCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Retained D1 values ignored</dt>
              <dd>{report.summary.retainedD1WordingCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Different from the deck</dt>
              <dd>{report.summary.differingD1WordingCount.toLocaleString()}</dd>
            </div>
          </dl>

          <div className={styles.copyOwnershipMeta}>
            <span>Page surfaces</span>
            <code>
              {report.surfaceSummary.surfaceCount.toLocaleString()} surfaces ·{" "}
              {report.surfaceSummary.fieldCount.toLocaleString()} fields
            </code>
            <span>Review classes</span>
            <code>
              {report.surfaceSummary.riskCounts.editorial.toLocaleString()} editorial
              {" · "}
              {report.surfaceSummary.riskCounts.fact_check.toLocaleString()} fact-check
            </code>
            <span>Git-owned fields</span>
            <code>{report.records[0]?.gitOwnedFields.join(" · ")}</code>
            <span>Copy version</span>
            <code>{report.copyVersion}</code>
          </div>

          <details className={styles.copyOwnershipDetails}>
            <summary>
              Review {report.surfaceSummary.surfaceCount.toLocaleString()} page
              surface{report.surfaceSummary.surfaceCount === 1 ? "" : "s"}
            </summary>
            <ol>
              {report.surfaces.map((surface) => (
                <li key={surface.id}>
                  <div>
                    <strong>{surface.id}</strong>
                    <code>{surface.deckPath}</code>
                  </div>
                  <span>
                    {surface.riskCounts.editorial.toLocaleString()} editorial ·{" "}
                    {surface.riskCounts.fact_check.toLocaleString()} fact-check
                  </span>
                  <p>
                    {surface.routeScopes.join(" · ")} ·{" "}
                    {surface.fieldCount.toLocaleString()} fields
                  </p>
                </li>
              ))}
            </ol>
          </details>

          <details className={styles.copyOwnershipDetails}>
            <summary>
              Review {retained?.length.toLocaleString() ?? "0"} retained D1
              value{retained?.length === 1 ? "" : "s"}
            </summary>
            {retained && retained.length > 0 ? (
              <ol>
                {retained.map((record) => (
                  <li key={record.id}>
                    <div>
                      <strong>{record.gitCopy.displayTitle}</strong>
                      <code>{record.deckPath}</code>
                    </div>
                    <span>
                      {record.ignoredD1WordingState === "matches_copy"
                        ? "Matches current deck"
                        : "Differs from current deck"}
                    </span>
                    <p>{record.ignoredD1Wording}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No retained WorkGroup wording remains in D1.</p>
            )}
          </details>

          <a
            className={styles.copyOwnershipLink}
            href="/api/studio/copy-ownership"
            target="_blank"
            rel="noreferrer"
          >
            Open the complete read-only report
          </a>
        </>
      ) : (
        <p className={styles.copyOwnershipUnavailable} role="status">
          The D1 comparison is unavailable. The reviewed Git copy deck remains
          authoritative.
        </p>
      )}
    </section>
  );
}
