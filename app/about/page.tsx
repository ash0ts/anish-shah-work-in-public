import type { Metadata } from "next";
import Link from "next/link";
import { publicBundle } from "@/lib/content";

export const metadata: Metadata = {
  title: "About",
  description:
    "About Anish Shah’s practice across applied AI products, education, open source, and technical communities.",
};

const principles = [
  {
    title: "Make it work",
    body: "Start near the actual workflow. A technical idea becomes useful only when someone can put it to work.",
  },
  {
    title: "Make it legible",
    body: "Explanations are part of the product. Courses, talks, and demos turn emerging systems into shared practice.",
  },
  {
    title: "Make it public",
    body: "Publish the artifact, preserve the context, and let other builders inspect what happened.",
  },
] as const;

export default function AboutPage() {
  const { profile } = publicBundle;
  return (
    <main id="main" className="site-main">
      <header className="about-hero">
        <p className="utility-label">About · a practice in three verbs</p>
        <h1>Build. Teach. Convene.</h1>
        <div>
          <p>{profile.summary}</p>
          <Link className="primary-action" href="/work">
            Explore my work <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className="about-profile">
        <aside>
          <span className="about-monogram">AS</span>
          <p>
            No portrait required. The work, the public artifacts, and the people
            they reached carry the identity here.
          </p>
        </aside>
        <div className="about-copy">
          <p className="utility-label">Current focus</p>
          <h2>Applied AI that survives contact with the real world.</h2>
          <p>
            Anish Shah works at Weights &amp; Biases across product, education,
            open source, and technical community programs. His public record
            spans agents, evaluation, MLOps, model development, and the
            infrastructure that helps teams understand what their systems are
            doing.
          </p>
          <p>
            The recurring job is translation: emerging capability into a usable
            product surface, a practical explanation, and a room where builders
            can compare notes.
          </p>
        </div>
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <p className="utility-label">Operating principles</p>
        <h2 id="principles-title">Three ways the work moves.</h2>
        <div>
          {principles.map((principle, index) => (
            <article key={principle.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="profile-links" aria-labelledby="profiles-title">
        <h2 id="profiles-title">Find the public trail.</h2>
        <div>
          {profile.links.map((link) => (
            <a href={link.href} key={link.href} rel="noreferrer" target="_blank">
              <span>{link.label}</span>
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
