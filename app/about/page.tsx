import type { Metadata } from "next";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "Anish Shah’s applied AI practice across products, education, open source, and technical communities.",
};

const trajectory = [
  ["2021", "Operational ML", "Working demos and reproducible workflows for teams shipping ML systems."],
  ["2022—23", "Generative systems", "Public explanations, workshops, and practical interfaces for a fast-changing field."],
  ["2024—25", "Evaluation and adoption", "Courses and programs where builders could test ideas against real work."],
  ["Now", "Agent-native product", "Evaluation, open tools, and product surfaces for agentic workflows."],
] as const;

const principles = [
  ["Make it work", "Start near the actual workflow. Capability becomes useful when someone can put it to work."],
  ["Make it legible", "Treat explanations as product surfaces: courses, demos, talks, and precise documentation."],
  ["Make it public", "Publish the artifact, preserve its context, and let other builders inspect what happened."],
] as const;

export default function AboutPage() {
  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>About · Anish Shah</p>
        <h1>Applied AI that survives contact with the real world.</h1>
        <p>
          Anish Shah is an applied AI builder and educator at Weights &amp;
          Biases. Since 2021, his public work has followed ML systems from
          reproducible operations through evaluation, agents, and the tools
          around them.
        </p>
      </header>

      <section className={styles.focus} aria-labelledby="focus-title">
        <p className={styles.eyebrow}>Current focus</p>
        <h2 id="focus-title">Evaluation and agent-native product.</h2>
        <p>
          The current question is practical: how should agents discover tools,
          use context, and leave evidence a team can trust? The work spans
          product surfaces, open integrations, and learning material for
          builders taking those systems into production.
        </p>
      </section>

      <section className={styles.trajectory} aria-labelledby="trajectory-title">
        <header>
          <p className={styles.eyebrow}>2021—now</p>
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

      <section className={styles.principles} aria-labelledby="principles-title">
        <header>
          <p className={styles.eyebrow}>Operating principles</p>
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
    </main>
  );
}
