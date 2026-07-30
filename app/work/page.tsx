import type { Metadata } from "next";
import { VisualArchive } from "@/components/VisualArchive";
import { WorkArchive } from "@/components/WorkArchive";
import { getPublicContentView } from "@/lib/server/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Work",
  description:
    "A searchable public index of Anish Shah’s courses, products, open-source work, talks, recordings, and technical writing.",
};

export default async function WorkPage() {
  const { bundle, source } = await getPublicContentView();
  const publishedItems = bundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const items =
    source === "published_snapshot"
      ? publishedItems
      : [...publishedItems].sort(
          (left, right) =>
            (right.date.start ?? "").localeCompare(left.date.start ?? "") ||
            right.title.localeCompare(left.title),
        );
  const narratives = bundle.narratives.filter(
    (narrative) => narrative.placement === "work",
  );

  return (
    <main id="main" className="site-main">
      <header className="index-hero">
        <p className="utility-label">The public index · 2021—now</p>
        <h1>
          Work that can
          <span>be opened.</span>
        </h1>
        <div className="index-hero-close">
          <p>
            {items.length} public records across products, education, open
            source, technical storytelling, and the rooms where the field meets.
          </p>
          <a href="#archive-browser-title">Search the index ↓</a>
        </div>
      </header>

      <section className="practice-strands" aria-label="Operating practices">
        {narratives.map((narrative, index) => (
          <article key={narrative.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{narrative.title}</h2>
            <p>{narrative.body}</p>
          </article>
        ))}
      </section>

      <VisualArchive
        items={items.map(({ id, slug, title, type, year, topics }) => ({
          id,
          slug,
          title,
          type,
          year,
          topics,
        }))}
      />

      <WorkArchive items={items} organizations={bundle.organizations} />
    </main>
  );
}
