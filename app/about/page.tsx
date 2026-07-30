import type { Metadata } from "next";
import Link from "next/link";
import { getPublicContentView } from "@/lib/server/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About",
  description:
    "Anish Shah’s applied AI practice across products, education, open source, and technical communities.",
};

const trajectory = [
  ["2021", "Enter", "Technical growth, working demos, and direct contact with teams building ML systems."],
  ["2022—23", "Explain", "Public talks, workshops, and technical stories for fast-changing AI workflows."],
  ["2024—25", "Gather", "Programs where practitioners and product teams could compare real work."],
  ["Now", "Ship", "Agent infrastructure, evaluation, open tools, and the work of adoption."],
] as const;

const principles = [
  ["Make it work", "Start near the actual workflow. Capability becomes useful when someone can put it to work."],
  ["Make it legible", "Treat explanations as product surfaces: courses, demos, talks, and precise documentation."],
  ["Make it public", "Publish the artifact, preserve its context, and let other builders inspect what happened."],
] as const;

export default async function AboutPage() {
  const { bundle } = await getPublicContentView();
  const { profile } = bundle;

  return (
    <main id="main" className="site-main v11-about">
      <header className="v11-about-hero">
        <p className="utility-label">About · Anish Shah</p>
        <h1>Applied AI that survives contact with the real world.</h1>
        <div>
          <p>{profile.summary}</p>
          <Link className="primary-action" href="/work">
            Explore my work <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className="v11-about-focus" aria-labelledby="focus-title">
        <p className="utility-label">Current focus</p>
        <div>
          <h2 id="focus-title">Products, learning systems, and technical rooms.</h2>
          <div>
            <p>
              Anish works at Weights &amp; Biases across applied AI product,
              education, open source, and technical community programs. The
              public archive spans agents, evaluation, MLOps, model development,
              and the infrastructure that helps teams understand what their
              systems are doing.
            </p>
            <p>
              The recurring job is translation: emerging capability into a
              usable product surface, a practical explanation, and a setting
              where builders can compare what works.
            </p>
          </div>
        </div>
      </section>

      <section className="v11-trajectory" aria-labelledby="trajectory-title">
        <header>
          <p className="utility-label">2021—now</p>
          <h2 id="trajectory-title">A widening practice.</h2>
        </header>
        <ol>
          {trajectory.map(([year, title, body]) => (
            <li key={year}>
              <span>{year}</span>
              <strong>{title}</strong>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="v11-principles" aria-labelledby="principles-title">
        <header>
          <p className="utility-label">Operating principles</p>
          <h2 id="principles-title">How the work moves.</h2>
        </header>
        <ol>
          {principles.map(([title, body]) => (
            <li key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="v11-profile-links" aria-labelledby="profiles-title">
        <h2 id="profiles-title">Follow the public trail.</h2>
        <div>
          {profile.links.map((link) => (
            <a href={link.href} key={link.href} rel="noreferrer" target="_blank">
              <span>{link.label}</span><i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
