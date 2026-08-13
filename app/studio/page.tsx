import type { Metadata } from "next";
import Link from "next/link";
import {
  authenticatedSignOutPath,
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import { resolveDiscogsCallbackUrl } from "@/lib/server/connectors/discogs-oauth";
import { resolveMyAnimeListCallbackUrl } from "@/lib/server/connectors/myanimelist-oauth";
import { resolveSpotifyCallbackUrl } from "@/lib/server/connectors/spotify-oauth";
import {
  getStudioCollectionsView,
  getStudioOverview,
  isPublicConnectorProvider,
} from "@/lib/server/connectors";
import { getCopyOwnershipReport } from "@/lib/server/copy-ownership";
import { listEditorialRecords } from "@/lib/server/editorial";
import { ownerAuthorizationForEmail } from "@/lib/server/owner-auth";
import { ensureSanitizedPublicRecords } from "@/lib/server/public-record-seed";
import { runtimeValue } from "@/lib/server/runtime-env";
import { CopyOwnershipSummary } from "./CopyOwnershipSummary";
import { EditorialRecords } from "./EditorialRecords";
import { PlayPromotionControls } from "./PlayPromotionControls";
import { SimulationProviderApprovals } from "./SimulationProviderApprovals";
import { StudioCollections } from "./StudioCollections";
import { TravelDeskEntry } from "./travel/TravelDeskEntry";
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

export default async function StudioPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) ?? {};
  const connectorQuery = Array.isArray(query.connector)
    ? query.connector[0]
    : query.connector;
  const initialExpandedProvider =
    typeof connectorQuery === "string" &&
    isPublicConnectorProvider(connectorQuery) &&
    (connectorQuery === "myanimelist" ||
      connectorQuery === "spotify" ||
      connectorQuery === "discogs")
      ? connectorQuery
      : null;
  const user = await requireChatGPTUser("/studio");
  const isLocalStudio = user.authSource === "local-development";
  const ownerAuthorization = ownerAuthorizationForEmail(user.email);
  const configuredSiteUrl = runtimeValue("SITE_URL");
  const deploymentTier = runtimeValue("DEPLOYMENT_TIER");
  const releasePrefix = runtimeValue("RELEASE_SHA")?.slice(0, 12);
  const myAnimeListCallbackUrl = configuredSiteUrl
    ? resolveMyAnimeListCallbackUrl(
        configuredSiteUrl,
        configuredSiteUrl,
        runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
      )
    : null;
  const spotifyCallbackUrl = configuredSiteUrl
    ? resolveSpotifyCallbackUrl(
        configuredSiteUrl,
        configuredSiteUrl,
        runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
      )
    : null;
  const discogsCallbackUrl = configuredSiteUrl
    ? resolveDiscogsCallbackUrl(
        configuredSiteUrl,
        configuredSiteUrl,
        runtimeValue("NODE_ENV") ?? process.env.NODE_ENV,
      )
    : null;

  if (ownerAuthorization.status === "forbidden") {
    return (
      <main className={styles.shell} id="main">
        <div className={styles.topline}>
          <Link href="/" className={styles.wordmark}>
            AS / Studio
          </Link>
          <a href={authenticatedSignOutPath(user, "/")} className={styles.utilityLink}>
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
      <main className={styles.shell} id="main">
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
  const overview = await getStudioOverview(user.email);
  const connectors = overview.connectors;
  const [initialEditorialRecords, copyOwnershipReport, collectionsView] =
    overview.status === "ready"
      ? await Promise.all([
          listEditorialRecords({ limit: 50, offset: 0 }),
          getCopyOwnershipReport().catch(() => null),
          getStudioCollectionsView(user.email, overview, {
            myanimelist:
              overview.encryptionConfigured && Boolean(myAnimeListCallbackUrl),
            hardcover: overview.encryptionConfigured,
            spotify:
              overview.encryptionConfigured && Boolean(spotifyCallbackUrl),
            discogs:
              overview.encryptionConfigured && Boolean(discogsCallbackUrl),
            steam:
              overview.encryptionConfigured &&
              Boolean(overview.steamStorageCountries),
            strava: overview.encryptionConfigured,
          }),
        ])
      : [
          null,
          null,
          await getStudioCollectionsView(user.email, overview, {
            myanimelist: false,
            hardcover: false,
            spotify: false,
            discogs: false,
            steam: false,
            strava: false,
          }),
        ];

  return (
    <main className={styles.shell} id="main">
      <div className={styles.topline}>
        <Link href="/" className={styles.wordmark}>
          AS / Studio
        </Link>
        <div className={styles.ownerMeta}>
          <span className={styles.identity}>{user.email}</span>
          {isLocalStudio ? (
            <span className={styles.localTag}>Local sandbox</span>
          ) : deploymentTier === "staging" ? (
            <span className={styles.localTag}>
              STAGING · {releasePrefix ?? "unversioned"}
            </span>
          ) : (
            <a href={authenticatedSignOutPath(user, "/")} className={styles.utilityLink}>
              Sign out
            </a>
          )}
        </div>
      </div>

      {isLocalStudio ? (
        <section
          className={styles.environmentNotice}
          aria-labelledby="local-environment-title"
        >
          <div className={styles.environmentStatus}>
            <span aria-hidden="true" />
            Local sandbox · isolated data
          </div>
          <div className={styles.environmentCopy}>
            <h2 id="local-environment-title">
              Changes here stay on this machine.
            </h2>
            <p>
              Credentials, snapshots, sync history, and editorial changes are
              stored in project-local D1. Deploying code does not copy them;
              the one-time handoff below can promote only reviewed Play
              provider settings.
            </p>
          </div>
          <ol className={styles.environmentPath}>
            <li>
              <strong>Test here</strong>
              <span>Connect, refresh, and inspect the local Play page.</span>
            </li>
            <li>
              <strong>Deploy code</strong>
              <span>Ship validated code and intended non-secret settings.</span>
            </li>
            <li>
              <strong>Promote settings</strong>
              <span>
                Create a one-time code in production, stage portable settings
                here, then validate and apply them there. Authorize
                MyAnimeList, Spotify, and Discogs separately.
              </span>
            </li>
          </ol>
        </section>
      ) : null}

      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          {isLocalStudio ? "Local owner workbench" : "Owner control room"}
        </p>
        <h1>Publish deliberately.</h1>
        <p>
          {isLocalStudio
            ? "Validate connector behavior and editorial changes against isolated local state before promoting them."
            : "Review the public projection, make narrow editorial changes, and refresh personal streams without exposing private source data."}
        </p>
      </header>

      <section className={styles.section} aria-labelledby="connectors-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Collections</p>
          <h2 id="connectors-title">One state. One next action.</h2>
          <p>
            {isLocalStudio
              ? "Connect, allow public use, then sync each local collection. Failed syncs keep the last accepted local snapshot."
              : "Connect, allow public use, then sync. Refreshes run only when you choose them, and failures keep the saved snapshot."}
          </p>
        </div>
        {!overview.encryptionConfigured ? (
          <div className={styles.inlineNotice}>
            <strong>Credential encryption needs setup.</strong>
            <span>
              {isLocalStudio ? (
                <>
                  Add a new local-only base64-encoded 32-byte{" "}
                  <code>CONNECTOR_ENCRYPTION_KEY</code> to{" "}
                  <code>.env.local</code>, then restart{" "}
                  <code>npm run dev:studio</code>.
                </>
              ) : (
                <>
                  Add a base64-encoded 32-byte{" "}
                  <code>CONNECTOR_ENCRYPTION_KEY</code> before connecting any
                  personal-data provider.
                </>
              )}
            </span>
          </div>
        ) : null}
        {!overview.steamStorageCountries ? (
          <div className={styles.inlineNotice}>
            <strong>Steam release gate is closed.</strong>
            <span>
              Set <code>STEAM_DATA_STORAGE_COUNTRIES</code> to the actual
              country or countries where D1 stores sanitized Steam snapshots
              {isLocalStudio ? " in .env.local, then restart Studio" : ""}.
              Steam credentials and sync remain disabled until this disclosure
              is truthful and public.
            </span>
          </div>
        ) : null}
        <StudioCollections
          initialView={collectionsView}
          connectors={connectors}
          environment={isLocalStudio ? "local" : "hosted"}
          encryptionConfigured={overview.encryptionConfigured}
          discogsCallbackUrl={discogsCallbackUrl}
          myAnimeListCallbackUrl={myAnimeListCallbackUrl}
          spotifyCallbackUrl={spotifyCallbackUrl}
          steamStorageCountries={overview.steamStorageCountries}
          initialExpandedProvider={initialExpandedProvider}
        />
      </section>

      <PlayPromotionControls
        environment={
          isLocalStudio
            ? "local"
            : deploymentTier === "staging"
              ? "staging"
              : "hosted"
        }
      />

      <TravelDeskEntry atlasMode={runtimeValue("TRAVEL_ATLAS_MODE") ?? null} />

      {overview.status !== "database_setup_required" &&
      runtimeValue("SIMULATION_EXPERIENCE_MODE") !== "disabled" ? (
        <SimulationProviderApprovals />
      ) : null}

      {overview.status === "database_setup_required" ? (
        <SetupNotice title="The site database is not ready.">
          {overview.reason === "binding_unavailable"
            ? isLocalStudio
              ? "Restart with npm run dev:studio so the project-local DB binding and migrations are available."
              : "Provision the logical DB binding through Sites."
            : overview.reason === "schema_unavailable"
              ? isLocalStudio
                ? "Stop the server, run npm run db:local:migrate, then restart the local Studio."
                : "Apply the checked-in D1 migration before using Studio."
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
            <span>
              {isLocalStudio ? "Latest local snapshot" : "Latest publication"}
            </span>
            <strong>
              {overview.latestPublication
                ? `${overview.latestPublication.recordCount.toLocaleString()} records · ${overview.latestPublication.contentHash.slice(0, 12)}`
                : "No publication snapshot yet"}
            </strong>
          </div>
          <CopyOwnershipSummary report={copyOwnershipReport} />
          {initialEditorialRecords ? (
            <EditorialRecords
              initial={initialEditorialRecords}
              isLocalSandbox={isLocalStudio}
              copyOwnershipReport={copyOwnershipReport}
            />
          ) : null}
        </section>
      )}
    </main>
  );
}
