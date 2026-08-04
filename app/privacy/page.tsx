import type { Metadata } from "next";
import { steamStorageCountries } from "@/lib/server/connectors/steam-policy";
import { publicPageMetadata } from "@/lib/seo";
import styles from "./privacy.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy and personal streams",
  description:
    "Learn what Anish Shah’s connectors and optional Meet Me simulation process, publish, retain, and delete, plus how to report an issue.",
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
          Spotify, Discogs, MyAnimeList, Hardcover, or Strava account data.
        </p>
        <small>Owner-controlled · sanitized public snapshots only</small>
      </header>

      <article className={styles.policy}>
        <section>
          <h2>Six connections and one owner-authored atlas</h2>
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
              <dt>Spotify · Listen</dt>
              <dd>
                Studio stores an encrypted app client secret plus renewable
                access and refresh tokens. It requests only the permissions
                needed to identify the owner and retrieve Spotify’s Top Tracks
                affinity for its approximate four-week, six-month, and
                one-year windows. D1 stores at most twelve ordered tracks per
                window, reduced artwork references, synchronization dates,
                and the owner’s separate publication choice. The site does not
                store play counts, listening history, popularity, preview
                audio, country, subscription, or raw provider responses; it
                does not infer listening time, genre, trends, or a taste
                profile. An optional official track, album, or playlist Embed
                is blocked until a visitor explicitly chooses to load it.
              </dd>
            </div>
            <div>
              <dt>Discogs · Collect</dt>
              <dd>
                Studio stores an encrypted consumer secret, access token, and
                access-token secret after owner-authorized OAuth. D1 stores one
                sanitized snapshot of the owner’s physical collection. The
                public endpoint returns titles, artists, release years,
                normalized physical formats, copy counts, format and decade
                distributions, and a profile link. Copies and distinct
                releases remain separate counts. Images, conditions, ratings,
                notes, acquisition dates, folders, wantlists, inventory,
                marketplace data, pricing, sales, account identifiers, and raw
                provider responses are excluded.
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
            <div>
              <dt>Postcard Planet · Travel</dt>
              <dd>
                Anish uploads his own historical travel photos through the
                protected owner Studio. Accepted images are reoriented,
                stripped of embedded metadata, and stored as metadata-free
                WebP masters in a private media bucket. The public atlas stores
                only reviewed trip copy, required alt text, optional captions
                and tags, and owner-approved geography. Approximate-city pins
                are rounded to 0.1 degrees; exact GPS, original filenames,
                camera identifiers, and raw uploads are never stored as public
                data. Planned and current trips expose only country or region,
                month-level dates, and no photos.
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2>Storage and retention</h2>
          <p>
            MyAnimeList, Hardcover, Spotify, and Steam refresh no more than
            once every 12 hours unless the protected owner Studio requests a
            refresh. Discogs becomes refreshable after four hours and its
            catalog becomes unavailable six hours after the last successful
            synchronization. D1 retains at most the latest two complete
            sanitized snapshots for the other API providers and one current
            Discogs snapshot. Transient failures preserve only snapshots still
            inside their documented public window. Steam’s public fallback and
            Spotify’s API-derived display expire after 72 hours; expired
            Spotify metadata is deleted after 30 days.
          </p>
          <p>
            Raw provider responses are processed in memory and discarded.
            Operational history is limited to provider, result, timestamps,
            safe error codes, and item counts; it never contains credentials,
            OAuth codes, or raw payloads.
          </p>
          <p>
            A raw Travel upload remains only while its protected upload
            transaction is processed and is deleted after successful
            conversion. Failed and abandoned temporary uploads are removed
            within 24 hours. Processed photo masters remain private while the
            owner keeps the trip; public variants are served only while their
            exact photo and digest belong to the active publication. Photo
            responses ask search engines not to index the images.
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
          <p>
            Unpublishing a Travel trip immediately removes the trip and all of
            its places and photos from the active public atlas. Deleting the
            trip also schedules its private processed media for removal. There
            is no per-photo public visibility switch: a reviewed trip publishes
            or unpublishes as one unit.
          </p>
        </section>

        <section>
          <h2>Visitors and provider terms</h2>
          <p>
            Selecting Watch, Read, Listen, Collect, or Play requests only this
            site’s sanitized first-party snapshot. The Discogs catalog is not
            requested until Collect is active. Spotify album artwork is
            requested only after Listen is active. The Spotify player has a
            separate consent gate and is not requested until the visitor
            chooses to load it. Selecting Move requests the stored embed
            configuration, but no request reaches Strava until the visitor
            grants consent. The site does not collect a visitor’s account data
            from any of these providers.
          </p>
          <p>
            Opening Travel requests this site’s published atlas and, when a
            visitor chooses a photo, a same-origin processed image. It does not
            request map tiles, contact a geocoder, expose an original upload,
            or collect a visitor location. The interactive globe and the
            semantic atlas show the same reviewed public places.
          </p>
          <p>
            Spotify content is attributed to Spotify and links back to the
            corresponding Spotify surface. Top Tracks means
            Spotify-calculated affinity for the labeled time window, not play
            counts or a listening-history export. This is a personal,
            noncommercial Spotify surface. The optional Spotify Embed may set
            or read provider cookies after consent. Review the{" "}
            <a href="https://developer.spotify.com/terms">
              Spotify Developer Terms
            </a>{" "}
            and{" "}
            <a href="https://developer.spotify.com/documentation/embeds/terms">
              Spotify Embed Terms
            </a>
            .
          </p>
          <p>
            Discogs data is presented as a personal, noncommercial physical
            catalog and links back to individual Discogs release pages. This
            application uses Discogs’ API but is not affiliated with, sponsored
            or endorsed by Discogs.
            Review the{" "}
            <a href="https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use">
              Discogs API Terms of Use
            </a>
            .
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

        <section>
          <h2>Meet Me simulation and optional AI processing</h2>
          <p>
            <strong>4N1SH is a generated game character assembled from Anish
            Shah’s public work and approved public collection snapshots. It is
            not Anish, does not speak for Anish or W&amp;B, and can be wrong.</strong>{" "}
            The campaign remains fully completable with authored dialogue when
            its model service is unavailable or when a visitor chooses not to
            write anything.
          </p>
          <p>
            The campaign contains exactly two optional text prompts, each
            limited to 280 characters. If used, the message is sent to
            Anthropic through Cloudflare AI Gateway to generate a short,
            schema-bounded character response. The application processes that
            text in memory and converts any useful result into a small fixed set
            of game signals. It does not write the visitor message, the model
            prompt, or the raw provider response to D1, KV, application logs,
            analytics, or browser persistence. To make a retried turn
            idempotent, D1 may retain the validated, length-bounded character
            line and its allowlisted game IDs with the short-lived session; that
            safe projection is removed with the session no later than two hours
            after expiry. Cloudflare and Anthropic still process the request
            under their own applicable terms and policies. Do not enter
            confidential, sensitive, or personal information.
          </p>
          <p>
            A one-hour opaque session cookie coordinates revision-safe game
            turns. D1 stores only its one-way hash, safe scene and action IDs,
            fixed visitor-signal enums, bounded counters, and expiry. Campaign
            progress kept in session storage stays in the current browser tab.
            Completion, reset, or explicit exit deletes the active session;
            abandoned session rows are removed no later than two hours after
            expiry. There is no account, transcript, leaderboard, durable
            visitor profile, or cross-session behavioral history.
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
