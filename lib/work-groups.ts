import type {
  AnishContentBundle,
  WorkBucket as WorkBucketId,
  WorkGroup,
} from "@/types/content";

type BundleWithWorkGroups = AnishContentBundle & {
  workGroups?: WorkGroup[];
};

export type PublicWorkGroup = WorkGroup;

export type WorkBucket = {
  id: WorkBucketId;
  title: string;
  shortTitle: string;
  statement: string;
};

export const workBuckets: WorkBucket[] = [
  {
    id: "products-open-source",
    title: "Systems & Open Source",
    shortTitle: "Systems",
    statement:
      "Agent-facing interfaces, evaluation tooling, and ML infrastructure integrations released as public software.",
  },
  {
    id: "courses-learning",
    title: "Curricula & Workshops",
    shortTitle: "Curricula",
    statement:
      "Courses and multi-session instruction spanning prompting, LLM evaluation, fine-tuning, and agent engineering.",
  },
  {
    id: "writing-research",
    title: "Technical Writing & Implementations",
    shortTitle: "Writing",
    statement:
      "Articles and public implementations covering LLM support systems, prompt engineering, and arXiv summarization.",
  },
  {
    id: "talks-programs",
    title: "Technical Talks & Programs",
    shortTitle: "Talks",
    statement:
      "Public sessions on agent architecture, model fine-tuning, and evaluation across conferences and practitioner programs.",
  },
];

type HomepageWorkPresentation = {
  title: string;
  role: string;
};

const homepageWorkPresentationByGroupId = {
  "group:products:wandb-mcp": {
    title: "W&B MCP Server",
    role: "Contributor · launch coauthor",
  },
  "group:products:evalforge": {
    title: "EvalForge: evaluation-criteria generation & alignment",
    role: "Creator",
  },
  "group:products:lightning-fabric": {
    title: "W&B logging & checkpointing for Lightning Fabric",
    role: "Contributor · three upstream pull requests",
  },
  "group:courses:ai-curriculum": {
    title: "AI curriculum: prompting, evaluation & agents",
    role: "Instructor · three courses",
  },
  "group:courses:agentic-llm-series": {
    title: "Agentic LLM fine-tuning & evaluation",
    role: "Speaker / co-instructor · three sessions",
  },
  "group:courses:startup-school": {
    title: "Google Cloud Startup School: GenAI applications",
    role: "Presenter · two regional broadcasts + replay",
  },
  "group:writing:wandbot": {
    title: "WandBot: GPT-4 documentation support",
    role: "Coauthor",
  },
  "group:writing:prompt-engineering-langchain": {
    title: "Prompt engineering with LangChain & W&B",
    role: "Author",
  },
  "group:writing:automated-pdf-summarization": {
    title: "arXiv summarization with Claude & Weave",
    role: "Author · cookbook implementation contributor",
  },
  "group:talks:architecting-agents": {
    title: "Architecting & orchestrating AI agents",
    role: "Speaker / instructor · four public deliveries",
  },
  "group:talks:llm-agent-fine-tuning": {
    title: "LLM agent fine-tuning for task automation",
    role: "Speaker · two public deliveries",
  },
  "group:talks:building-evaluating-agents": {
    title: "Building agents with evaluation in the loop",
    role: "Conference speaker",
  },
} satisfies Record<string, HomepageWorkPresentation>;

const fallbackEntityIds: Record<WorkBucketId, string[]> = {
  "products-open-source": [
    "entity:wk-0001",
    "entity:wk-0003",
    "entity:wk-0002",
  ],
  "courses-learning": [
    "entity:wk-fp-0065",
    "entity:wk-fp-0066",
    "entity:wk-fp-0067",
  ],
  "writing-research": [
    "entity:wk-fp-0055",
    "entity:wk-fp-0053",
    "entity:wk-fp-0061",
  ],
  "talks-programs": [
    "entity:oc-fp-0045",
    "entity:oc-fp-0010",
    "entity:oc-fp-0046",
  ],
};

export function publicWorkGroupsFrom(
  bundle: AnishContentBundle,
): PublicWorkGroup[] {
  return ((bundle as BundleWithWorkGroups).workGroups ?? []).filter(
    (group) => group.publicationState === "public",
  );
}

export function featuredWorkBucketsFrom(bundle: AnishContentBundle) {
  const publicGroups = publicWorkGroupsFrom(bundle);
  const groups = publicGroups.length
    ? publicGroups
    : fallbackGroupsFromEntities(bundle);
  return workBuckets.map((bucket) => ({
    ...bucket,
    groups: groups
      .filter((group) => group.bucket === bucket.id)
      .filter((group) => group.featuredOrder !== null)
      .sort(
        (left, right) =>
          (left.featuredOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.featuredOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, 3)
      .map((group) => {
        const presentation =
          homepageWorkPresentationByGroupId[
            group.id as keyof typeof homepageWorkPresentationByGroupId
          ];
        return {
          ...group,
          homeTitle:
            presentation?.title ?? (group.shortTitle || group.title),
          homeRole: presentation?.role ?? group.roleSummary,
        };
      }),
  }));
}

export function findWorkGroupBySlugFrom(
  bundle: AnishContentBundle,
  slug: string,
) {
  return publicWorkGroupsFrom(bundle).find(
    (group) => group.slug === slug || group.slugAliases.includes(slug),
  );
}

export function workGroupForEntityFrom(
  bundle: AnishContentBundle,
  entityId: string,
) {
  const groups = publicWorkGroupsFrom(bundle);
  const direct = groups.find((group) =>
    group.memberEntityIds.includes(entityId),
  );
  if (direct) return direct;
  const contextual = groups.filter(
    (group) =>
      group.programEntityIds.includes(entityId) ||
      group.contextEntityIds.includes(entityId),
  );
  return contextual.length === 1 ? contextual[0] : undefined;
}

export function workGroupPeriodLabel(group: PublicWorkGroup) {
  if (group.yearStart && group.yearEnd && group.yearStart !== group.yearEnd) {
    return `${group.yearStart}—${String(group.yearEnd).slice(-2)}`;
  }
  return String(group.yearEnd ?? group.yearStart ?? "Undated");
}

function fallbackGroupsFromEntities(
  bundle: AnishContentBundle,
): PublicWorkGroup[] {
  const itemById = new Map(bundle.items.map((item) => [item.id, item]));
  return workBuckets.flatMap((bucket) =>
    fallbackEntityIds[bucket.id].flatMap((entityId, index) => {
      const entity = bundle.entities.find(
        (candidate) =>
          candidate.id === entityId && candidate.publicationState === "public",
      );
      if (!entity) return [];
      const items = entity.itemIds
        .map((itemId) => itemById.get(itemId))
        .filter(Boolean);
      const formats = [
        ...new Set(
          items.flatMap((item) => (item ? [item.type] : [])),
        ),
      ];
      return [
        {
          id: `fallback:${entity.id}`,
          slug: entity.slug,
          slugAliases: entity.slugAliases,
          title: entity.displayTitle,
          shortTitle: entity.shortTitle,
          summary: entity.summary,
          bucket: bucket.id,
          featuredOrder: index + 1,
          primaryEntityId: entity.id,
          memberEntityIds: [entity.id],
          programEntityIds: [],
          contextEntityIds: [],
          itemIds: entity.itemIds,
          yearStart: entity.year,
          yearEnd: entity.year,
          roleSummary: entity.role,
          period: entity.representativeDate,
          organizationIds: entity.organizationIds,
          topics: entity.topics,
          formats,
          publicationState: "public",
          verificationState: entity.verificationState,
        },
      ] satisfies PublicWorkGroup[];
    }),
  );
}
