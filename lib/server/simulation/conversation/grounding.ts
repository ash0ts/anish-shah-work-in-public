import type { AnishContentBundle, PublicImpactMetric } from "@/types/content";
import { workArchiveRecordsFrom } from "@/lib/work-index";
import { SITE_COPY } from "@/lib/copy";
import type { ConversationSource } from "@/lib/simulation/conversation-contract";

/** Exact public projector. Raw evidence, private corroboration and Travel never enter it. */
export function conversationSources(
  bundle: AnishContentBundle,
): ConversationSource[] {
  const evidence = new Map(
    bundle.evidence
      .filter((source) => source.access === "public_web")
      .map((source) => [source.id, source]),
  );
  const items = new Map(
    bundle.items
      .filter((item) => item.publicationState === "public")
      .map((item) => [item.id, item]),
  );
  const groups = new Map(bundle.workGroups.map((group) => [group.id, group]));
  const works = workArchiveRecordsFrom(bundle);
  const visible = new Set(works.map((work) => work.id));
  const citations = (ids: readonly string[]) =>
    [...new Set(ids)].flatMap((id) => {
      const source = evidence.get(id);
      return source
        ? [
            {
              id,
              title: source.title,
              href: `/sources#${encodeURIComponent(id)}`,
            },
          ]
        : [];
    });
  const cards: ConversationSource[] = works.map((work) => ({
    id: work.id,
    title: work.title,
    text: [work.summary, `Role: ${work.role}.`]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1_200),
    limit: null,
    href: `/work/${work.slug}`,
    period: work.year ? String(work.year) : null,
    citations: citations(
      (groups.get(work.id)?.itemIds ?? []).flatMap(
        (id) => items.get(id)?.evidenceIds ?? [],
      ),
    ),
  }));
  for (const metric of bundle.metrics) {
    if (metric.publicationState !== "public" || !("displayValue" in metric))
      continue;
    // A hidden project cannot survive through a separately listed metric.
    const subject = groups.get(metric.subjectId);
    if (subject && !visible.has(subject.id)) continue;
    if (!metric.displaySurfaces.length) continue;
    const m = metric as PublicImpactMetric;
    cards.push({
      id: m.id,
      title: `${m.displayValue} ${m.label}`,
      text: `${m.displayValue} ${m.label}. ${m.sourceLabel}. Scope: ${m.scope}. Attribution: ${m.attribution}.`,
      limit: m.qualifier,
      period: m.period.label,
      href: "/sources#internal-analytics",
      citations: citations(m.publicEvidenceIds),
    });
  }
  cards.push({
    id: "about:approved",
    title: "About Anish",
    text: `${SITE_COPY.about.body} ${SITE_COPY.about["current-focus"]}`,
    limit: "Approved biography; not a personal representative.",
    period: null,
    href: "/about",
    citations: [],
  });
  return cards;
}
