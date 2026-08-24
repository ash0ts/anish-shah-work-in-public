import type { Metadata } from "next";
import { steamStorageCountries } from "@/lib/server/connectors/steam-policy";
import { publicPageMetadata } from "@/lib/seo";
import styles from "./privacy.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy and collections",
  description:
    "What Anish Shah’s connectors and travel atlas store, publish, retain, and delete—and how visitors control third-party loads.",
  path: "/privacy",
});

export default function PrivacyPage() {
  const storageCountries = steamStorageCountries();

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Privacy · Collections and travel</p>
        <h1>Personal data stays deliberately small.</h1>
        <p>
          The site retrieves Anish’s public activity after owner-authorized
          setup. It does not collect a visitor’s Steam, Spotify, Discogs,
          MyAnimeList, Hardcover, or Strava account data.
        </p>
        <small>Owner-controlled · sanitized collections and photos</small>
      </header>

      <article className={styles.policy}>
        <section>
          <h2>What is stored</h2>
          <p>
            Six connections and one owner-authored atlas each have a narrow
            input, a bounded public output, and an explicit deletion path.
          </p>
          <dl className={styles.providerMatrix}>
            <div>
              <dt>MyAnimeList · Watch</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
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
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Hardcover · Read</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
                    Studio stores one encrypted owner API token. The authenticated
                    user ID is used only to request the owner library; it is not
                    published. D1 stores a complete sanitized shelf snapshot; the
                    public endpoint returns whole-shelf reading and rating
                    distributions, one bounded gallery page, recent books, and a
                    profile link derived from the authenticated username. Cover
                    URLs are reduced to host-free references and never exposed to
                    browser code.
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Spotify · Listen</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
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
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Discogs · Collect</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
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
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Steam · Play</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
                    Studio encrypts the Web API key and SteamID64 together. D1
                    stores the complete public game library with rounded hours.
                    The public endpoint returns whole-library totals and playtime
                    bands, one bounded gallery page, and at most eight highlighted
                    titles. Passwords, exact minutes, presence, friends, bans,
                    achievements, inventories, real names, locations, remote
                    artwork URLs, and raw responses are excluded. Documented game
                    icon hashes may be stored as host-free references and served
                    through the same-origin artwork endpoint.
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Strava · Move</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
                    No Strava API credential or custom activity dataset is stored.
                    Studio keeps the public athlete profile, an optional exact
                    Strava-generated profile-feed, summary, activity, or route
                    iframe URL, and its last anonymous frame check. A redirecting
                    or blocked widget is not shown publicly; visitors receive the
                    athlete-profile link instead. A working third-party iframe
                    remains blocked until a visitor explicitly chooses to load it.
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Postcard Planet · Travel</dt>
              <dd>
                <details>
                  <summary>Stored and published data</summary>
                  <p>
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
                  </p>
                </details>
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2>What visitors load</h2>
          <p>
            Watch, Read, Listen, Collect, and Play request only this site’s
            sanitized first-party snapshots. Discogs data loads only after
            Collect opens. Spotify artwork loads only after Listen opens. The
            Spotify player stays blocked until the visitor chooses to load it.
          </p>
          <p>
            Move first requests the saved embed configuration. No request reaches
            Strava until the visitor grants consent. The site does not collect a
            visitor’s provider account data.
          </p>
          <p>
            Travel requests the published atlas and, after a photo selection, a
            same-origin processed image. It does not request map tiles, contact a
            geocoder, expose an original upload, or collect a visitor location.
            The globe and semantic atlas show the same reviewed places.
          </p>
        </section>

        <section>
          <h2>Storage and deletion</h2>
          <p>
            MyAnimeList, Hardcover, Spotify, Discogs, and Steam synchronize only
            when the protected owner selects Refresh now in Studio. Public reads
            and scheduled maintenance never request new collection data. Strava
            checks its saved public widget only when the owner saves it or selects
            Verify feed now.
          </p>
          <p>
            D1 retains at most two complete sanitized snapshots for each
            collection provider: the current version and one rollback version. A
            failed request never replaces the last accepted snapshot. With an
            active owner-recorded publication approval, an accepted collection
            remains available as a saved snapshot with its actual update time.
            Age alone never deletes it. Once publication-approval enforcement is
            active, a missing, disabled, or expired approval withholds public
            display without deleting the private snapshot. Publication references
            are encrypted and never returned by Studio, public APIs, health
            responses, logs, or bundles.
          </p>
          <p>
            Raw provider responses are processed in memory and discarded.
            Operational history is limited to provider, result, timestamps, safe
            error codes, and item counts; it never contains credentials, OAuth
            codes, or raw payloads.
          </p>
          <p>
            A raw Travel upload remains only while its protected upload transaction
            is processed and is deleted after successful conversion. Failed and
            abandoned temporary uploads are removed within 24 hours. Processed
            photo masters remain private while the owner keeps the trip; public
            variants are served only while their exact photo and digest belong to
            the active publication. Photo responses ask search engines not to
            index the images.
          </p>
          <p>
            {storageCountries
              ? `Steam’s encrypted credential, sanitized snapshots, and operational sync metadata are declared as stored in: ${storageCountries}.`
              : "Steam is disabled. Before it can be connected or published, the owner must configure the country or countries where its encrypted credential, sanitized snapshots, and operational sync metadata are stored."}
          </p>

          <h3>Disconnect, replace, or unpublish</h3>
          <p>
            Disconnecting a provider removes its encrypted credentials
            or embed configuration, sanitized snapshots, pending OAuth transaction,
            sync history, and provider-specific audit history. The public collection
            becomes unavailable immediately. A minimal deletion event containing
            no provider values remains.
          </p>
          <p>
            Replacing credentials invalidates in-flight work, clears the prior
            provider state, and requires a successful refresh before a new snapshot
            is public. If Steam stops returning public game details, every prior
            Steam snapshot is removed and replaced by a non-public visibility
            marker. Private games are never reconstructed or inferred.
          </p>
          <p>
            Unpublishing a Travel trip immediately removes the trip and all of its
            places and photos from the active public atlas. Deleting the trip also
            schedules its private processed media for removal. There is no
            per-photo public visibility switch: a reviewed trip publishes or
            unpublishes as one unit.
          </p>

        </section>

        <aside
          aria-labelledby="accessibility-contact-title"
          className={styles.policySection}
        >
          <h2 id="accessibility-contact-title">Accessibility and issue reporting</h2>
          <p>
            This site targets WCAG 2.2 Level AA and is tested with keyboard,
            screen-reader, zoom, reduced-motion, and high-contrast settings. That
            target is an ongoing practice, not a legal certification.
          </p>
          <p>
            If something is difficult to use—or a privacy or security concern
            appears—contact Anish through{" "}
            <a
              href="https://www.linkedin.com/in/anish-shah"
              rel="noreferrer"
              target="_blank"
            >
              LinkedIn
            </a>
            . Include the page, browser or assistive technology, and the expected
            result when those details are safe to share.
          </p>
        </aside>

        <section>
          <h2>Provider terms</h2>
          <dl className={styles.providerMatrix}>
            <div>
              <dt>Spotify</dt>
              <dd>
                <details>
                  <summary>Attribution, limits, and terms</summary>
                  <p>
                    Spotify content is attributed to Spotify and links back to the
                    corresponding Spotify surface. Top Tracks means
                    Spotify-calculated affinity for the labeled time window, not
                    play counts or a listening-history export. This is a personal,
                    noncommercial Spotify surface. The optional Spotify Embed may
                    set or read provider cookies after consent. Review the{" "}
                    <a href="https://developer.spotify.com/terms">
                      Spotify Developer Terms
                    </a>{" "}
                    and{" "}
                    <a href="https://developer.spotify.com/documentation/embeds/terms">
                      Spotify Embed Terms
                    </a>
                    .
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Discogs</dt>
              <dd>
                <details>
                  <summary>Non-affiliation and terms</summary>
                  <p>
                    Discogs data is presented as a personal, noncommercial physical
                    catalog and links back to individual Discogs release pages. This
                    application uses Discogs’ API but is not affiliated with,
                    sponsored or endorsed by Discogs. Review the{" "}
                    <a href="https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use">
                      Discogs API Terms of Use
                    </a>
                    .
                  </p>
                </details>
              </dd>
            </div>
            <div>
              <dt>Steam</dt>
              <dd>
                <details>
                  <summary>Non-affiliation, disclaimer, and terms</summary>
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
                    Steam Web API data is shown “as is,” “with all faults,” and
                    “as available,” without warranties of accuracy, availability,
                    or fitness. To the maximum extent permitted by law, Valve,
                    Steam game publishers and developers, and their suppliers are
                    not liable for damages arising from use of the Steam Web API or
                    Steam data.
                  </p>
                </details>
              </dd>
            </div>
          </dl>
        </section>
      </article>
    </main>
  );
}
