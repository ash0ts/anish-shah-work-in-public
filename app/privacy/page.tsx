import type { Metadata } from "next";
import { steamStorageCountries } from "@/lib/server/connectors/steam-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy and personal streams",
  description:
    "What the personal data connectors retrieve, store, publish, retain, and delete.",
};

export default function PrivacyPage() {
  const storageCountries = steamStorageCountries();

  return (
    <main id="main" className="site-main">
      <header className="sources-hero">
        <div className="sources-hero-meta">
          <p className="utility-label">Privacy · personal streams</p>
          <p>Owner-controlled · public snapshots only</p>
        </div>
        <h1>Personal data stays deliberately small.</h1>
        <p>
          The connectors retrieve Anish’s own public activity after an
          owner-authorized setup. They do not collect a visitor’s Steam,
          MyAnimeList, Hardcover, or Strava account data.
        </p>
      </header>

      <section className="method-grid" aria-label="Personal stream policy">
        <article>
          <span>Retrieve</span>
          <h2>Only what the public experience needs.</h2>
          <p>
            Steam uses an owner-supplied Web API key and SteamID64 to request
            the owner’s public profile, public game details, and recently played
            games. The site never asks for or stores a Steam password.
          </p>
        </article>
        <article>
          <span>Publish</span>
          <h2>Bounded summaries, never raw responses.</h2>
          <p>
            Steam publishes rounded aggregate hours and at most eight top-played
            and eight recent public titles. API keys, standalone SteamIDs,
            avatars, cover URLs, friends, presence, inventory, achievements,
            exact minutes, and raw provider responses are excluded.
          </p>
        </article>
        <article>
          <span>Delete</span>
          <h2>Privacy changes close the stream.</h2>
          <p>
            If Steam no longer returns public game details, the stored public
            snapshot is removed and replaced by a non-public visibility marker.
            Prior Steam sync history is cleared at the same time. Disconnecting
            Steam deletes its encrypted credential, every stored Steam snapshot,
            and its Steam-specific sync and audit history; only a minimal
            deletion event with no Steam values remains.
          </p>
        </article>
      </section>

      <section className="claim-register" aria-labelledby="storage-title">
        <div>
          <p className="utility-label">Storage and retention</p>
          <h2 id="storage-title">A disclosed, short-lived cache.</h2>
        </div>
        <div>
          <article>
            <strong>12h</strong>
            <div>
              <h3>Refresh window</h3>
              <p>
                Cached public snapshots are automatically refreshed no more
                than once every twelve hours; the protected owner studio can
                also request a manual refresh. Transient provider failures may
                use the last successful Steam snapshot for no more than 72
                hours.
              </p>
            </div>
          </article>
          <article>
            <strong>2</strong>
            <div>
              <h3>Snapshot limit</h3>
              <p>
                D1 retains at most the latest two sanitized Steam snapshots.
                While connected, operational history contains only the provider,
                result, timestamps, and item count. Raw provider payloads are
                processed in memory and discarded.
              </p>
            </div>
          </article>
          <article>
            <strong>{storageCountries ? "Set" : "Gate"}</strong>
            <div>
              <h3>Storage-country disclosure</h3>
              <p>
                {storageCountries
                  ? `The encrypted Steam credential, sanitized snapshots, and operational sync metadata are stored in: ${storageCountries}.`
                  : "Steam is disabled. Before a key can be saved or synchronized, the owner must configure and publish the actual country or countries where the encrypted credential, sanitized snapshots, and operational sync metadata are stored."}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="method-grid" aria-label="Steam terms and attribution">
        <article>
          <span>Control</span>
          <h2>Steam visibility remains authoritative.</h2>
          <p>
            The stream describes “public games returned by Steam,” not a
            complete library. Games marked private by the owner are not
            reconstructed, inferred, or published.
          </p>
        </article>
        <article>
          <span>Source</span>
          <h2>Data provided by Steam.</h2>
          <p>
            This independent personal site is not endorsed by or affiliated
            with Valve. Review the{" "}
            <a href="https://steamcommunity.com/dev/apiterms">
              Steam Web API Terms
            </a>{" "}
            and{" "}
            <a href="https://help.steampowered.com/en/faqs/view/588C-C67D-0251-C276">
              Steam Profile Privacy guidance
            </a>
            .
          </p>
        </article>
        <article>
          <span>Disclaimer</span>
          <h2>Steam data is shown as available.</h2>
          <p>
            Steam Web API data is provided “as is,” “with all faults,” and “as
            available,” without warranties of accuracy, availability, or
            fitness. To the maximum extent permitted by law, Valve, Steam game
            publishers and developers, and their suppliers are not liable for
            damages arising from use of the Steam Web API or Steam data.
          </p>
        </article>
      </section>
    </main>
  );
}
