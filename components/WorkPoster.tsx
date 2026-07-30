import Link from "next/link";
import { formatItemType, organizationNames } from "@/lib/content";
import type { PortfolioItem } from "@/types/content";

const posterWords = ["SHIP", "TEACH", "TEST", "SHARE", "BUILD", "OPEN"] as const;

export function WorkPoster({
  item,
  index,
}: {
  item: PortfolioItem;
  index: number;
}) {
  const organizations = organizationNames(item);
  return (
    <Link
      className={`work-poster work-poster-${(index % 8) + 1}`}
      href={`/work/${item.slug}`}
    >
      <span className="poster-ghost" aria-hidden="true">
        {posterWords[index % posterWords.length]}
      </span>
      <span className="poster-topline">
        <span>{formatItemType(item.type)}</span>
        <span>{item.year ?? "Current"}</span>
      </span>
      <span className="poster-title">{item.title}</span>
      <span className="poster-foot">
        <span>{item.role}</span>
        <span>{organizations.slice(0, 1).join("") || "Public artifact"}</span>
      </span>
      <span className="poster-open">
        Open case <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}
