import Link from "next/link";
import type { PublicImpactMetric } from "@/types/content";

export function ImpactMoments({
  metrics,
}: {
  metrics: PublicImpactMetric[];
}) {
  return (
    <div className="impact-moments">
      {metrics.map((metric, index) => (
        <article className={`impact-moment impact-moment-${index + 1}`} key={metric.id}>
          <div className="impact-value" aria-label={`${metric.displayValue} ${metric.label}`}>
            {metric.displayValue}
          </div>
          <div className="impact-context">
            <p className="utility-label">Measured reach · {metric.period.label}</p>
            <h3>{metric.label}</h3>
            <p>{metric.qualifier}</p>
            <details>
              <summary>Read the source note</summary>
              <p>
                {metric.sourceLabel}
                {metric.period.asOf ? ` · as of ${metric.period.asOf}` : ""}
              </p>
              <Link href={`/sources#${metric.id}`}>Open methodology ↗</Link>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}
