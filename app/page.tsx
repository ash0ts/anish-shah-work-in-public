import type { Metadata } from "next";
import Link from "next/link";
import { HeroStage } from "@/components/HeroStage";
import { ImpactMoments } from "@/components/ImpactMoments";
import { Reveal } from "@/components/Reveal";
import { WorkPoster } from "@/components/WorkPoster";
import {
  featuredItemsFrom,
  getPublicContentView,
  homepageMetricsFrom,
} from "@/lib/server/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Applied AI, in public",
  description:
    "Anish Shah is an applied AI builder, educator, and technical storyteller at Weights & Biases.",
};

const trajectory = [
  {
    year: "2021",
    verb: "Enter",
    body: "Joined W&B near the product: technical growth, working demos, and direct contact with the people building ML systems.",
  },
  {
    year: "2022—23",
    verb: "Explain",
    body: "Turned emerging workflows into public talks, practical workshops, and reusable technical stories.",
  },
  {
    year: "2024—25",
    verb: "Gather",
    body: "Built programs where practitioners, researchers, and product teams could compare real work in public.",
  },
  {
    year: "Now",
    verb: "Ship",
    body: "Working where agent infrastructure, evaluation, open tools, and adoption meet.",
  },
] as const;

export default async function Home() {
  const { bundle, source } = await getPublicContentView();
  const items = featuredItemsFrom(bundle, 8, source === "published_snapshot");
  const metrics = homepageMetricsFrom(bundle);
  const { profile } = bundle;

  return (
    <main id="main" className="site-main">
      <HeroStage
        headline={profile.headline}
        items={items}
        summary={profile.summary}
      />

      <section className="selected-work" aria-labelledby="selected-work-title">
        <div className="section-intro">
          <div>
            <p className="utility-label">Selected work · eight ways in</p>
            <h2 id="selected-work-title">The work is the introduction.</h2>
          </div>
          <p>
            Courses, open-source tools, talks, and technical stories—each one
            opens to the role, context, and evidence behind it.
          </p>
        </div>
        <div className="poster-wall">
          {items.map((item, index) => (
            <WorkPoster item={item} index={index} key={item.id} />
          ))}
        </div>
        <div className="section-exit">
          <span>{bundle.items.length} public records · 2021—now</span>
          <Link className="primary-action" href="/work">
            Open the full index <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <section className="impact-section" aria-labelledby="impact-title">
        <Reveal className="impact-heading">
          <p className="utility-label">Impact, with its edges left on</p>
          <h2 id="impact-title">Scale means more with context.</h2>
          <p>
            These measures are rounded, dated, and qualified. Program reach
            stays separate from personal contribution; supported pipeline is
            not presented as generated revenue.
          </p>
        </Reveal>
        <ImpactMoments metrics={metrics} />
      </section>

      <section className="trajectory-section" aria-labelledby="trajectory-title">
        <div className="trajectory-heading">
          <p className="utility-label">A widening practice · 2021—now</p>
          <h2 id="trajectory-title">From making the demo to shaping the room.</h2>
        </div>
        <div className="trajectory-line">
          {trajectory.map((step) => (
            <article key={step.year}>
              <span>{step.year}</span>
              <h3>{step.verb}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="play-invitation" aria-labelledby="play-title">
        <div className="play-copy">
          <p className="utility-label">Off the clock, still keeping score</p>
          <h2 id="play-title">Watch. Read. Move.</h2>
          <p>
            Anime seasons, books in progress, and miles outside—the quieter
            data streams that make the workday make sense.
          </p>
          <Link className="light-action" href="/play">
            See what else I track <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="play-bands" aria-hidden="true">
          <span className="play-band play-band-anime">
            <i>WATCH</i>
            <b>01</b>
          </span>
          <span className="play-band play-band-reading">
            <i>READ</i>
            <b>02</b>
          </span>
          <span className="play-band play-band-motion">
            <i>MOVE</i>
            <b>03</b>
          </span>
        </div>
      </section>
    </main>
  );
}
