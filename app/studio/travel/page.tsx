import type { Metadata } from "next";
import Link from "next/link";
import { authenticatedSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { runtimeValue } from "@/lib/server/runtime-env";
import { TravelDesk } from "./TravelDesk";
import styles from "./travel.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Travel Desk · Anish Shah",
  robots: { index: false, follow: false },
};

export default async function TravelStudioPage() {
  const user = await requireChatGPTUser("/studio/travel");
  const authorization = ownerAuthorizationForEmail(user.email);
  const deploymentTier = runtimeValue("DEPLOYMENT_TIER");
  const environment =
    user.authSource === "local-development"
      ? "local"
      : deploymentTier === "staging"
        ? "staging"
        : "production";

  if (authorization.status !== "allowed") {
    return (
      <main className={styles.page} id="main">
        <nav className={styles.topline} aria-label="Travel Desk">
          <Link href="/studio">AS / Studio</Link>
          <a href={authenticatedSignOutPath(user, "/")}>Sign out</a>
        </nav>
        <section className={styles.blocked}>
          <p className={styles.kicker}>Owner access required</p>
          <h1>Travel Desk is locked.</h1>
          <p>
            This route requires both authenticated access and the exact owner
            email allowlist.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} id="main">
      <nav className={styles.topline} aria-label="Travel Desk">
        <Link href="/studio">← AS / Studio</Link>
        <div>
          <span>{environment}</span>
          {environment !== "local" ? (
            <a href={authenticatedSignOutPath(user, "/")}>Sign out</a>
          ) : null}
        </div>
      </nav>
      <header className={styles.hero}>
        <p className={styles.kicker}>Postcard Planet · owner workspace</p>
        <h1>Put each memory on the map—deliberately.</h1>
        <p>
          Date and GPS suggestions are read only in this browser. Raw bytes
          pass through protected processing that removes their metadata; only
          the place, date, caption, and coarsened pin you approve can reach the
          public atlas.
        </p>
      </header>
      <TravelDesk environment={environment} />
    </main>
  );
}
