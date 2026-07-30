import type { Metadata } from "next";
import Link from "next/link";
import { HeroStage } from "@/components/HeroStage";
import {
  getPublicContentView,
  homepageMetricsFrom,
} from "@/lib/server/public-content";
import {
  representativeWorksFrom,
  workIndexEntriesFrom,
} from "@/lib/work-index";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Applied AI, in public",
  description:
    "Anish Shah builds applied AI products, learning systems, and technical communities at Weights & Biases.",
};

const practiceCopy = {
  teach: "Turn emerging AI workflows into something people can use, test, and carry forward.",
  build: "Ship the product surfaces and open tools that make experimental systems operable.",
  convene: "Create rooms where practitioners can compare the work—and understand its reach.",
} as const;

export default async function Home() {
  const { bundle } = await getPublicContentView();
  const entries = workIndexEntriesFrom(bundle);
  const representatives = representativeWorksFrom(entries);
  const metrics = homepageMetricsFrom(bundle);

  return (
    <main id="main" className="site-main v11-home">
      <HeroStage
        entries={entries}
        headline={bundle.profile.headline}
        summary={bundle.profile.summary}
      />

      <section className="v11-practice" aria-labelledby="practice-title">
        <header>
          <p className="utility-label">Three ways into the work</p>
          <h2 id="practice-title">Teach. Build. Convene.</h2>
          <Link href="/work">Open the complete index ↗</Link>
        </header>
        <div>
          {representatives.map((entry) => (
            <Link
              className="v11-work-row"
              href={`/work/${entry.slug}`}
              key={entry.id}
            >
              <span className="v11-work-practice">{entry.practice}</span>
              <span className="v11-work-title">
                <strong>{entry.title}</strong>
                <small>{practiceCopy[entry.practice]}</small>
              </span>
              <span className="v11-work-meta">
                {entry.year ?? "Date open"} · {entry.formCount}{" "}
                {entry.formCount === 1 ? "public form" : "public forms"}
              </span>
              <i aria-hidden="true">↗</i>
            </Link>
          ))}
        </div>
      </section>

      <section className="v11-impact" aria-labelledby="impact-title">
        <header>
          <p className="utility-label">Three bounded outcomes</p>
          <h2 id="impact-title">Reach, with the edges left on.</h2>
          <Link href="/sources#internal-analytics">Read the methodology ↗</Link>
        </header>
        <div className="v11-impact-grid">
          {metrics.map((metric) => (
            <article key={metric.id}>
              <strong>{metric.displayValue}</strong>
              <h3>{metric.label}</h3>
              <p>{metric.qualifier}</p>
              <span>
                {metric.sourceLabel} · {metric.period.label}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="v11-close" aria-labelledby="current-focus-title">
        <div>
          <p className="utility-label">Current focus</p>
          <h2 id="current-focus-title">
            Agent infrastructure, evaluation, and the work of adoption.
          </h2>
        </div>
        <p>
          The professional archive stays inspectable. The quieter data streams—
          anime, books, games, and movement—live somewhere more playful.
        </p>
        <nav aria-label="Continue exploring">
          <Link className="primary-action" href="/work">
            Explore my work <span aria-hidden="true">↗</span>
          </Link>
          <Link className="text-action" href="/play">
            Watch, read, play, move
          </Link>
        </nav>
      </section>
    </main>
  );
}
