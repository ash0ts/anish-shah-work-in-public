import type { Metadata } from "next";
import { steamStorageCountries } from "@/lib/server/connectors/steam-policy";
import { publicPageMetadata } from "@/lib/seo";
import styles from "./privacy.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy and personal streams",
  description:
    "Learn what Anish Shah’s personal data connectors retrieve, store, publish, retain, and delete, plus how to report an issue.",
  path: "/privacy",
});

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
                minutes. D1 stores a complete sanitized library snapshot so
                status, genre, era, and score distributions reflect the whole
                collection. The public endpoint returns those distributions,
                one bounded gallery page, and a profile link derived from the
                authorized identity. Cover URLs are reduced to host-free
                references and served only through the bounded same-origin
                artwork endpoint while the snapshot remains published.
              </dd>
            </div>
            <div>
              <dt>Hardcover · Read</dt>
              <dd>
                Studio stores one encrypted owner API token. The authenticated
                user ID is used only to request the owner library; it is not
                published. D1 stores a complete sanitized shelf snapshot; the
                public endpoint returns whole-shelf reading and rating
                distributions, one bounded gallery page, recent books, and a
                profile link derived from the authenticated username. Cover
                URLs are reduced to host-free references and never exposed to
                browser code.
              </dd>
            </div>
            <div>
              <dt>Steam · Play</dt>
              <dd>
                Studio encrypts the Web API key and SteamID64 together. D1
                stores the complete public game library with rounded hours.
                The public endpoint returns whole-library totals and playtime
                bands, one bounded gallery page, and at most eight highlighted
                titles. Passwords, exact minutes, presence, friends, bans,
                achievements, inventories, real names, locations, remote
                artwork URLs, and raw responses are excluded. Documented game
                icon hashes may be stored as host-free references and served
                through the same-origin artwork endpoint.
              </dd>
            </div>
            <div>
              <dt>Strava · Move</dt>
              <dd>
                No Strava API credential or custom activity dataset is stored.
                Studio keeps the public athlete profile, an optional exact
                Strava-generated profile-feed, summary, activity, or route
                iframe URL, and its last anonymous frame check. A redirecting
                or blocked widget is not shown publicly; visitors receive the
                athlete-profile link instead. A working third-party iframe
                remains blocked until a visitor explicitly chooses to load it.
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2>Storage and retention</h2>
          <p>
            MyAnimeList, Hardcover, and Steam refresh no more than once every
            12 hours unless the protected owner Studio requests a refresh. D1
            retains at most the latest two complete sanitized snapshots for
            each provider. A public request receives only a page-sized gallery
            rather than the stored collection. Transient failures preserve the
            latest eligible last-known-good snapshot; Steam’s public fallback
            expires after 72 hours.
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

        <section aria-labelledby="accessibility-contact-title">
          <h2 id="accessibility-contact-title">
            Accessibility and issue reporting
          </h2>
          <p>
            This site targets WCAG 2.2 Level AA and is tested with keyboard,
            screen-reader, zoom, reduced-motion, and high-contrast settings.
            That target is an ongoing practice, not a legal certification.
          </p>
          <p>
            If something is difficult to use—or you notice a privacy or
            security concern—contact Anish through{" "}
            <a
              href="https://www.linkedin.com/in/anish-shah"
              rel="noreferrer"
              target="_blank"
            >
              LinkedIn
            </a>
            . Include the page, browser or assistive technology, and what you
            expected to happen when those details are safe to share.
          </p>
        </section>
      </article>
    </main>
  );
}
