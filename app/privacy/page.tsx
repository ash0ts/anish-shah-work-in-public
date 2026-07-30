import type { Metadata } from "next";
import { steamStorageCountries } from "@/lib/server/connectors/steam-policy";
import styles from "./privacy.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy and personal streams",
  description:
    "What the personal data connectors retrieve, store, publish, retain, and delete.",
};

export default function PrivacyPage() {
  const storageCountries = steamStorageCountries();

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Privacy · personal streams</p>
        <h1>Personal data stays deliberately small.</h1>
        <p>
          These connectors retrieve Anish’s own public activity after
          owner-authorized setup. They do not collect a visitor’s Steam,
          MyAnimeList, Hardcover, or Strava account data.
        </p>
        <small>Owner-controlled · sanitized public snapshots only</small>
      </header>

      <article className={styles.policy}>
        <section>
          <h2>What the site retrieves</h2>
          <p>
            MyAnimeList and Hardcover provide owner-authorized watch and reading
            states. Steam uses an owner-supplied Web API key and SteamID64 to
            request the owner’s public profile, public game details, and
            recently played games. The site never asks for or stores a Steam
            password.
          </p>
          <p>
            Strava is different: no custom activity data is retrieved. Its
            official public embed remains blocked until a visitor chooses to
            load it.
          </p>
        </section>

        <section>
          <h2>What becomes public</h2>
          <p>
            Only bounded summaries reach the public site. Steam publishes
            rounded aggregate hours and at most eight top-played and eight
            recent public titles. API keys, standalone SteamIDs, avatars,
            artwork URLs, friends, presence, inventory, achievements, exact
            minutes, real names, locations, and raw provider responses are
            excluded.
          </p>
          <p>
            A Steam library count means “public games returned by Steam,” not a
            complete library. Private games are not reconstructed or inferred.
          </p>
        </section>

        <section>
          <h2>Storage and retention</h2>
          <p>
            Public snapshots refresh no more than once every 12 hours. The
            protected owner studio may also request a refresh. Transient
            provider failures may use the last successful Steam snapshot for no
            more than 72 hours, and D1 keeps at most the latest two sanitized
            Steam snapshots.
          </p>
          <p>
            {storageCountries
              ? `The encrypted Steam credential, sanitized snapshots, and operational sync metadata are stored in: ${storageCountries}.`
              : "Steam is disabled. Before it can be connected or published, the owner must configure the country or countries where its encrypted credential, sanitized snapshots, and operational sync metadata are stored."}
          </p>
          <p>
            While connected, operational history includes only the provider,
            result, timestamps, and item count. Raw provider payloads are
            processed in memory and discarded.
          </p>
        </section>

        <section>
          <h2>Deletion and visibility changes</h2>
          <p>
            If Steam stops returning public game details, the public snapshot is
            removed and replaced by a non-public visibility marker. Its prior
            sync history is cleared at the same time.
          </p>
          <p>
            Disconnecting Steam deletes its encrypted credential, all stored
            Steam snapshots, and Steam-specific sync and audit history. A
            minimal deletion event with no Steam values remains.
          </p>
        </section>

        <section>
          <h2>Steam attribution and terms</h2>
          <p>
            Data provided by Steam. This independent personal site is not
            endorsed by or affiliated with Valve. Review the{" "}
            <a href="https://steamcommunity.com/dev/apiterms">
              Steam Web API Terms
            </a>{" "}
            and{" "}
            <a href="https://help.steampowered.com/en/faqs/view/588C-C67D-0251-C276">
              Steam Profile Privacy guidance
            </a>
            .
          </p>
          <p>
            Steam Web API data is shown “as is,” “with all faults,” and “as
            available,” without warranties of accuracy, availability, or
            fitness. To the maximum extent permitted by law, Valve, Steam game
            publishers and developers, and their suppliers are not liable for
            damages arising from use of the Steam Web API or Steam data.
          </p>
        </section>
      </article>
    </main>
  );
}
