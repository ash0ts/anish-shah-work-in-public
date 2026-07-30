import type { Metadata } from "next";
import Link from "next/link";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import { getStudioOverview } from "@/lib/server/connectors";
import { listEditorialRecords } from "@/lib/server/editorial";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { ensureSanitizedPublicRecords } from "@/lib/server/public-record-seed";
import { ConnectorControls } from "./ConnectorControls";
import { EditorialRecords } from "./EditorialRecords";
import styles from "./studio.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Studio · Anish Shah",
  robots: { index: false, follow: false },
};

const publicationLabels: Record<string, string> = {
  public: "Published",
  review_required: "Needs review",
  private: "Private",
  excluded: "Excluded",
};

function SetupNotice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.notice}>
      <span>Setup required</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export default async function StudioPage() {
  const user = await requireChatGPTUser("/studio");
  const ownerAuthorization = ownerAuthorizationForEmail(user.email);

  if (ownerAuthorization.status === "forbidden") {
    return (
      <main className={styles.shell}>
        <div className={styles.topline}>
          <Link href="/" className={styles.wordmark}>
            AS / Studio
          </Link>
          <a href={chatGPTSignOutPath("/")} className={styles.utilityLink}>
            Sign out
          </a>
        </div>
        <SetupNotice title="This account is not on the owner allowlist.">
          Studio is restricted independently of ChatGPT sign-in. Ask the site
          owner to add the exact signed-in email address.
        </SetupNotice>
      </main>
    );
  }

  if (ownerAuthorization.status === "setup_required") {
    return (
      <main className={styles.shell}>
        <div className={styles.topline}>
          <Link href="/" className={styles.wordmark}>
            AS / Studio
          </Link>
          <span className={styles.identity}>{user.email}</span>
        </div>
        <SetupNotice title="Add the owner allowlist before opening Studio.">
          Set <code>OWNER_EMAILS</code> to a comma-separated list containing{" "}
          <code>{user.email}</code>. Until then, every Studio write API remains
          locked.
        </SetupNotice>
      </main>
    );
  }

  try {
    await ensureSanitizedPublicRecords(user.email);
  } catch {
    // The overview below converts missing bindings/migrations into a setup
    // state instead of failing the protected page.
  }
  const overview = await getStudioOverview();
  const connectors = overview.connectors;
  const initialEditorialRecords =
    overview.status === "ready"
      ? await listEditorialRecords({ limit: 50, offset: 0 })
      : null;

  return (
    <main className={styles.shell}>
      <div className={styles.topline}>
        <Link href="/" className={styles.wordmark}>
          AS / Studio
        </Link>
        <div className={styles.ownerMeta}>
          <span className={styles.identity}>{user.email}</span>
          <a href={chatGPTSignOutPath("/")} className={styles.utilityLink}>
            Sign out
          </a>
        </div>
      </div>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Owner control room</p>
        <h1>Publish deliberately.</h1>
        <p>
          Review the public projection, make narrow editorial changes, and
          refresh personal streams without exposing private source data.
        </p>
      </header>

      {overview.status === "database_setup_required" ? (
        <SetupNotice title="The site database is not ready.">
          {overview.reason === "binding_unavailable"
            ? "Provision the logical DB binding through Sites."
            : overview.reason === "schema_unavailable"
              ? "Apply the checked-in D1 migration before using Studio."
              : "The database could not be read. Existing public pages remain independent of this control surface."}
        </SetupNotice>
      ) : (
        <section className={styles.section} aria-labelledby="editorial-title">
            <div className={styles.sectionIntro}>
              <p className={styles.eyebrow}>Editorial state</p>
              <h2 id="editorial-title">The publication boundary</h2>
              <p>
                Only sanitized records belong here. Exact internal source data
                never enters the deployed database.
              </p>
            </div>
            <div className={styles.metricGrid}>
              {["public", "review_required", "private", "excluded"].map(
                (state) => (
                  <article className={styles.metricCard} key={state}>
                    <strong>
                      {(overview.publicationCounts[state] ?? 0).toLocaleString()}
                    </strong>
                    <span>{publicationLabels[state]}</span>
                  </article>
                ),
              )}
            </div>
            <div className={styles.releaseLine}>
              <span>Latest publication</span>
              <strong>
                {overview.latestPublication
                  ? `${overview.latestPublication.recordCount.toLocaleString()} records · ${overview.latestPublication.contentHash.slice(0, 12)}`
                  : "No publication snapshot yet"}
              </strong>
            </div>
            {initialEditorialRecords ? (
              <EditorialRecords initial={initialEditorialRecords} />
            ) : null}
          </section>
      )}

      <section className={styles.section} aria-labelledby="connectors-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Connector health</p>
          <h2 id="connectors-title">Personal data, published safely</h2>
          <p>
            Each refresh writes a new public-only snapshot. If a provider fails,
            the last successful snapshot remains available.
          </p>
        </div>
        <div className={styles.setupGuide} aria-labelledby="connector-setup-title">
          <div className={styles.setupGuideIntro}>
            <p className={styles.eyebrow}>Owner setup</p>
            <h3 id="connector-setup-title">Connect once. Publish deliberately.</h3>
          </div>
          <ol className={styles.setupSteps}>
            <li>
              <span>01</span>
              <p>
                <strong>Open the site gates.</strong> Apply the D1 migrations,
                allowlist the exact owner email, add the encryption key, and
                disclose Steam storage countries.
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>Get the owner credential.</strong> Use only the official
                provider pages below, then paste it into the matching card.
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                <strong>Publish the snapshot.</strong> Connect or replace the
                credential, run Refresh now, and confirm the card reports
                Current.
              </p>
            </li>
          </ol>
          <nav
            className={styles.providerLinks}
            aria-label="Official connector setup resources"
          >
            <a
              href="https://myanimelist.net/apiconfig"
              rel="noreferrer"
              target="_blank"
            >
              MyAnimeList developer portal
            </a>
            <a
              href="https://hardcover.app/account/api"
              rel="noreferrer"
              target="_blank"
            >
              Hardcover API token
            </a>
            <a
              href="https://steamcommunity.com/dev/apikey"
              rel="noreferrer"
              target="_blank"
            >
              Steam API key
            </a>
            <a
              href="https://help.steampowered.com/en/faqs/view/2816-BE67-5B69-0FEC"
              rel="noreferrer"
              target="_blank"
            >
              SteamID help
            </a>
            <a
              href="https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed"
              rel="noreferrer"
              target="_blank"
            >
              Strava embed guide
            </a>
          </nav>
          <p className={styles.setupFootnote}>
            MyAnimeList access tokens are renewed manually through Replace
            credential. Strava has no Studio credential: publish its official{" "}
            <code>strava-embeds.com</code> URL through the deployment
            environment, and visitors still choose whether to load it.
          </p>
        </div>
        {!overview.encryptionConfigured ? (
          <div className={styles.inlineNotice}>
            <strong>Credential encryption needs setup.</strong>
            <span>
              Add a base64-encoded 32-byte{" "}
              <code>CONNECTOR_ENCRYPTION_KEY</code> before connecting any
              personal-data provider.
            </span>
          </div>
        ) : null}
        {!overview.steamStorageCountries ? (
          <div className={styles.inlineNotice}>
            <strong>Steam release gate is closed.</strong>
            <span>
              Set <code>STEAM_DATA_STORAGE_COUNTRIES</code> to the actual
              country or countries where D1 stores sanitized Steam snapshots.
              Steam credentials and sync remain disabled until this disclosure
              is truthful and public.
            </span>
          </div>
        ) : null}
        <div className={styles.connectorGrid}>
          {connectors.map((connector) => (
            <ConnectorControls
              connector={connector}
              encryptionConfigured={overview.encryptionConfigured}
              steamStorageCountries={overview.steamStorageCountries}
              key={connector.provider}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
