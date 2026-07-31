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
          <h2>Four deliberately different connections</h2>
          <p>
            Each provider has a narrow input, a bounded public output, and an
            explicit deletion path.
          </p>
          <dl className={styles.providerMatrix}>
            <div>
              <dt>MyAnimeList · Watch</dt>
              <dd>
                Studio stores an encrypted app client secret plus renewable
                access and refresh tokens. A pending authorization stores only
                a hashed state and encrypted transaction for at most ten
                minutes. Public output is limited to watch-state counts, genre
                and era patterns, recent updates, and a profile link derived
                from the authorized identity.
              </dd>
            </div>
            <div>
              <dt>Hardcover · Read</dt>
              <dd>
                Studio stores one encrypted owner API token. The authenticated
                user ID is used only to request the owner library; it is not
                published. Public output is limited to reading-state counts,
                recent books, and a profile link derived from the authenticated
                username.
              </dd>
            </div>
            <div>
              <dt>Steam · Play</dt>
              <dd>
                Studio encrypts the Web API key and SteamID64 together. Public
                output contains rounded aggregate hours and at most eight
                top-played and eight recent public titles. Passwords, exact
                minutes, presence, friends, bans, achievements, inventories,
                real names, locations, artwork, and raw responses are excluded.
              </dd>
            </div>
            <div>
              <dt>Strava · Move</dt>
              <dd>
                No Strava API credential or custom activity dataset is stored.
                Studio keeps only one validated public{" "}
                <code>https://strava-embeds.com/…</code> source URL. The
                third-party iframe remains blocked until a visitor explicitly
                chooses to load it.
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2>Storage and retention</h2>
          <p>
            MyAnimeList, Hardcover, and Steam refresh no more than once every
            12 hours unless the protected owner Studio requests a refresh. D1
            retains at most the latest two sanitized snapshots for each
            provider. Transient failures preserve the latest eligible
            last-known-good snapshot; Steam’s public fallback expires after 72
            hours.
          </p>
          <p>
            Raw provider responses are processed in memory and discarded.
            Operational history is limited to provider, result, timestamps,
            safe error codes, and item counts; it never contains credentials,
            OAuth codes, or raw payloads.
          </p>
          <p>
            {storageCountries
              ? `Steam’s encrypted credential, sanitized snapshots, and operational sync metadata are declared as stored in: ${storageCountries}.`
              : "Steam is disabled. Before it can be connected or published, the owner must configure the country or countries where its encrypted credential, sanitized snapshots, and operational sync metadata are stored."}
          </p>
        </section>

        <section>
          <h2>Disconnect means delete and unpublish</h2>
          <p>
            Disconnecting any stream removes that provider’s encrypted
            credentials or embed configuration, sanitized snapshots, pending
            OAuth transaction, sync history, and provider-specific audit
            history. The public stream becomes unavailable immediately. A
            minimal deletion event containing no provider values remains.
          </p>
          <p>
            Replacing credentials invalidates in-flight work, clears the prior
            provider state, and requires a successful refresh before a new
            snapshot is public. If Steam stops returning public game details,
            every prior Steam snapshot is removed and replaced by a non-public
            visibility marker. Private games are never reconstructed or
            inferred.
          </p>
        </section>

        <section>
          <h2>Visitors and provider terms</h2>
          <p>
            Selecting Watch, Read, or Play requests only this site’s sanitized
            first-party snapshot. Selecting Move requests the stored embed
            configuration, but no request reaches Strava until the visitor
            grants consent. The site does not collect a visitor’s account data
            from any of these providers.
          </p>
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
