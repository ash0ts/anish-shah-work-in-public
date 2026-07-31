import type { Metadata } from "next";
import { PersonalStreams } from "@/components/PersonalStreams";
import { getPublicContentView } from "@/lib/server/public-content";
import { publicPageMetadata } from "@/lib/seo";
import styles from "./play.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Play",
  description:
    "Explore Anish Shah’s public anime, reading, gaming, and movement collections through bounded, owner-controlled snapshots.",
  path: "/play",
});

export default async function PlayPage() {
  const { bundle } = await getPublicContentView();
  const narrative = bundle.narratives.find(
    (entry) => entry.id === "narrative:play:personal-streams",
  );

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>
          Play · four optional public streams · pattern / gallery
        </p>
        <h1>Outside the work.</h1>
        <p>
          {narrative?.body ??
            "Watch, read, play, and move—published from owner-controlled snapshots and consent-gated embeds."}
        </p>
      </header>
      <PersonalStreams />
    </main>
  );
}
