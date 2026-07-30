import type { Metadata } from "next";
import { PersonalStreams } from "@/components/PersonalStreams";
import { getPublicContentView } from "@/lib/server/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Play",
  description:
    "Anime, books, and movement—the personal streams Anish Shah keeps outside the work archive.",
};

export default async function PlayPage() {
  const { bundle } = await getPublicContentView();
  const narrative = bundle.narratives.find(
    (entry) => entry.id === "narrative:play:personal-streams",
  );

  return (
    <main id="main" className="site-main play-page">
      <header className="play-page-hero">
        <p className="utility-label">Play · three public streams</p>
        <h1>
          There is life
          <span>outside the work.</span>
        </h1>
        <p>
          {narrative?.body ??
            "Anime, reading, and movement—published from owner-controlled snapshots and consent-gated embeds."}
        </p>
      </header>
      <PersonalStreams />
    </main>
  );
}
