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
import {
  ConnectorControls,
  StravaConnectorControls,
} from "./ConnectorControls";
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
  const isLocalStudio = user.authSource === "local-development";
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
  const overview = await getStudioOverview(user.email);
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
          {isLocalStudio ? (
            <span className={styles.localTag}>Local sandbox</span>
          ) : (
            <a href={chatGPTSignOutPath("/")} className={styles.utilityLink}>
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
              stored in project-local D1. Deploying the site does not copy any
              of them to production.
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
              <strong>Connect production</strong>
              <span>
                Re-enter credentials in the{" "}
                <a
                  href="https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site/studio"
                  rel="noreferrer"
                  target="_blank"
                >
                  HTTPS Studio
                </a>
                ; keep its encryption key unchanged.
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
          <p className={styles.eyebrow}>Connector health</p>
          <h2 id="connectors-title">
            {isLocalStudio
              ? "Personal data, tested safely"
              : "Personal data, published safely"}
          </h2>
          <p>
            {isLocalStudio
              ? "Each refresh writes a sanitized snapshot only to local D1. If a provider fails, the last successful local snapshot remains available."
              : "Each refresh writes a new public-only snapshot. If a provider fails, the last successful snapshot remains available."}
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
        <div className={styles.connectorGrid}>
          {connectors.map((connector) => (
            <ConnectorControls
              connector={connector}
              environment={isLocalStudio ? "local" : "hosted"}
              encryptionConfigured={overview.encryptionConfigured}
              steamStorageCountries={overview.steamStorageCountries}
              key={connector.provider}
            />
          ))}
          <StravaConnectorControls
            environment={isLocalStudio ? "local" : "hosted"}
          />
        </div>
      </section>

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
          {initialEditorialRecords ? (
            <EditorialRecords
              initial={initialEditorialRecords}
              isLocalSandbox={isLocalStudio}
            />
          ) : null}
        </section>
      )}
    </main>
  );
}
