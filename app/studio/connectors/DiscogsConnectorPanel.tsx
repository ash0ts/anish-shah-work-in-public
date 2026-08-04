"use client";

import { useEffect, useState } from "react";
import styles from "../studio.module.css";
import { ApiConnectorPanel } from "./ApiConnectorPanel";
import { formatTimestamp, responseJson } from "./helpers";
import type {
  DiscogsExtendedDisplayApproval,
  DiscogsPresentationConfig,
  Environment,
  ProviderMeta,
  ProviderPanelProps,
} from "./model";

const meta: ProviderMeta = {
  stream: "Collect",
  title: "Discogs",
  requirement: "Consumer key + consumer secret",
  sources: [
    {
      href: "https://www.discogs.com/settings/developers",
      label: "Open developer settings",
    },
    {
      href: "https://www.discogs.com/developers/",
      label: "Read API documentation",
    },
    {
      href: "https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use",
      label: "Review API terms",
    },
  ],
  summary:
    "Authorize the owner collection, synchronize physical releases, then make a separate decision about public display. Copies and distinct releases remain separate.",
  recovery:
    "If Discogs denies authorization, start again from this panel. A 401 requires reauthorization; a rate limit should be retried only after its wait period. Failed manual refreshes never replace the last accepted catalog.",
};

type Props = ProviderPanelProps & {
  callbackUrl: string | null;
};

export function DiscogsConnectorPanel({ callbackUrl, ...props }: Props) {
  return (
    <ApiConnectorPanel
      {...props}
      meta={meta}
      oauth={{
        provider: "discogs",
        title: "Discogs",
        startPath: "/api/studio/connectors/discogs/oauth/start",
        callbackUrl,
        credentialShape: {
          idLabel: "Consumer key",
          secretLabel: "Consumer secret",
          requestKeys: {
            id: "consumerKey",
            secret: "consumerSecret",
          },
          showsAccessTokenExpiry: false,
        },
      }}
    >
      <DiscogsPresentationControls
        key={[
          props.connector.configured ? "configured" : "disconnected",
          props.connector.status,
          props.connector.lastSyncedAt ?? "never-synced",
        ].join(":")}
        configured={props.connector.configured}
        environment={props.environment}
        lastSyncedAt={props.connector.lastSyncedAt}
      />
    </ApiConnectorPanel>
  );
}

type ConfigState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      config: DiscogsPresentationConfig;
      approval: DiscogsExtendedDisplayApproval | null;
    };

function DiscogsPresentationControls({
  configured,
  environment,
  lastSyncedAt,
}: {
  configured: boolean;
  environment: Environment;
  lastSyncedAt: string | null;
}) {
  const [state, setState] = useState<ConfigState>({ phase: "loading" });
  const [publishCollection, setPublishCollection] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalReference, setApprovalReference] = useState("");
  const [approvalExpiresAt, setApprovalExpiresAt] = useState("");
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [pending, setPending] = useState<"presentation" | "approval" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/studio/connectors/discogs/config", { cache: "no-store" })
      .then(async (response) => {
        const result = await responseJson(response);
        if (!active) return;
        if (
          response.ok &&
          result.config &&
          "publishCollection" in result.config
        ) {
          const approval = result.extendedDisplayApproval ?? null;
          setState({ phase: "ready", config: result.config, approval });
          setPublishCollection(result.config.publishCollection);
          setApprovalEnabled(approval?.enabled ?? false);
          setApprovalReference(approval?.reference ?? "");
          setApprovalExpiresAt(toDateTimeLocal(approval?.expiresAt ?? null));
          return;
        }
        setState({
          phase: "error",
          message:
            result.error ??
            "Discogs display settings could not be checked. Reload Studio and try again.",
        });
      })
      .catch(() => {
        if (active) {
          setState({
            phase: "error",
            message:
              "Discogs display settings could not be checked. Reload Studio and try again.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (publishCollection && !configured) {
      setMessage("Authorize and refresh Discogs before publishing the catalog.");
      return;
    }
    if (publishCollection && !acknowledged) {
      setMessage(
        "Acknowledge the personal, noncommercial public display before publishing.",
      );
      return;
    }
    setPending("presentation");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/discogs/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publishCollection,
          acknowledgeNoncommercial: publishCollection ? acknowledged : false,
        }),
      });
      const result = await responseJson(response);
      if (
        !response.ok ||
        !result.config ||
        !("publishCollection" in result.config)
      ) {
        setMessage(
          result.error ??
            "Discogs display settings could not be saved. Review the acknowledgement and try again.",
        );
        return;
      }
      setState((current) => ({
        phase: "ready",
        config: result.config as DiscogsPresentationConfig,
        approval: current.phase === "ready" ? current.approval : null,
      }));
      setPublishCollection(result.config.publishCollection);
      setAcknowledged(false);
      setMessage(
        result.config.publishCollection
          ? environment === "local"
            ? "The collection is visible in the local sandbox only. Production still requires separate authorization and review."
            : "The physical collection is published for noncommercial display."
          : "The Discogs collection is private.",
      );
    } catch {
      setMessage("Discogs display settings could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function saveApproval(): Promise<void> {
    const currentApproval = state.phase === "ready" ? state.approval : null;
    if (!approvalEnabled && currentApproval === null) {
      setMessage("No extended-display permission is currently recorded.");
      return;
    }
    if (approvalEnabled && !approvalReference.trim()) {
      setMessage("Enter the owner-only reference for the extended-display permission.");
      return;
    }
    if (approvalEnabled && !approvalAcknowledged) {
      setMessage(
        "Confirm that the recorded permission covers display beyond Discogs' standard six-hour window.",
      );
      return;
    }
    const expiryTimestamp = approvalExpiresAt
      ? Date.parse(approvalExpiresAt)
      : Number.NaN;
    if (approvalExpiresAt && !Number.isFinite(expiryTimestamp)) {
      setMessage("Choose a valid permission expiry.");
      return;
    }
    const expiresAt = Number.isFinite(expiryTimestamp)
      ? new Date(expiryTimestamp).toISOString()
      : null;
    if (
      expiresAt !== null &&
      (!Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <=
          Date.parse(currentApproval?.approvedAt ?? new Date().toISOString()))
    ) {
      setMessage("Choose an expiry later than the permission approval time.");
      return;
    }
    setPending("approval");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/discogs/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extendedDisplayApproval: {
            provider: "discogs",
            reference:
              approvalReference.trim() || currentApproval?.reference || "disabled",
            approvedAt: currentApproval?.approvedAt ?? new Date().toISOString(),
            expiresAt,
            enabled: approvalEnabled,
          },
        }),
      });
      const result = await responseJson(response);
      if (!response.ok || !result.approval) {
        setMessage(
          result.error ??
            "The extended-display permission could not be saved. Review the reference and dates.",
        );
        return;
      }
      setState((current) =>
        current.phase === "ready"
          ? { ...current, approval: result.approval ?? null }
          : current,
      );
      setApprovalEnabled(result.approval.enabled);
      setApprovalReference(result.approval.reference);
      setApprovalExpiresAt(toDateTimeLocal(result.approval.expiresAt));
      setApprovalAcknowledged(false);
      setMessage(
        result.approval.enabled
          ? "Extended Discogs display permission recorded. Older accepted catalogs may remain public and will be marked stale."
          : "Extended Discogs display permission disabled. The standard six-hour cutoff applies.",
      );
    } catch {
      setMessage("The extended-display permission could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  }

  const config = state.phase === "ready" ? state.config : null;
  const approval = state.phase === "ready" ? state.approval : null;
  const approvalIsActive = discogsApprovalIsActive(approval);

  return (
    <section
      className={styles.spotifyPublication}
      aria-labelledby="discogs-display-title"
    >
      <div className={styles.spotifyPublicationLead}>
        <div>
          <p className={styles.spotifyPublicationLabel}>Public display</p>
          <h4 id="discogs-display-title">Choose what leaves Studio.</h4>
        </div>
        {config ? (
          <dl>
            <div>
              <dt>Collection</dt>
              <dd>{config.publishCollection ? "Published" : "Private"}</dd>
            </div>
            <div>
              <dt>Last review</dt>
              <dd>
                {config.reviewedAt
                  ? formatTimestamp(config.reviewedAt)
                  : "Not yet reviewed"}
              </dd>
            </div>
            <div>
              <dt>Standard public cutoff</dt>
              <dd>{formatTimestamp(discogsPublicCutoff(lastSyncedAt))}</dd>
            </div>
            <div>
              <dt>Extended display</dt>
              <dd>
                {approvalIsActive
                  ? "Active"
                  : approval
                    ? "Inactive"
                    : "Not recorded"}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      {state.phase === "loading" ? (
        <p className={styles.configStatus} role="status">
          Checking display settings…
        </p>
      ) : state.phase === "error" ? (
        <p className={styles.configStatus} role="alert">
          {state.message}
        </p>
      ) : (
        <form
          className={styles.spotifyPublicationForm}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className={styles.publicationSwitch}>
            <input
              type="checkbox"
              checked={publishCollection}
              disabled={pending !== null}
              onChange={(event) => {
                setPublishCollection(event.target.checked);
                setAcknowledged(false);
              }}
            />
            <span>
              <strong>Publish physical collection publicly</strong>
              <small>
                Show sanitized titles, artists, years, formats, copy counts,
                and aggregate patterns. Private collection fields remain
                excluded.
              </small>
            </span>
          </label>

          {publishCollection ? (
            <label className={styles.publicationAcknowledgement}>
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={pending !== null}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I reviewed this as a personal, noncommercial catalog and will
                keep Discogs attribution and non-affiliation wording visible.
              </span>
            </label>
          ) : null}

          <div className={styles.formActions}>
            <button type="submit" disabled={pending !== null}>
              {pending === "presentation" ? "Saving…" : "Save Discogs display"}
            </button>
          </div>
        </form>
      )}

      {state.phase === "ready" ? (
        <form
          className={styles.spotifyPublicationForm}
          onSubmit={(event) => {
            event.preventDefault();
            void saveApproval();
          }}
        >
          <p className={styles.spotifyPublicationLabel}>
            Owner-only provider permission
          </p>
          <label className={styles.publicationSwitch}>
            <input
              type="checkbox"
              checked={approvalEnabled}
              disabled={pending !== null}
              onChange={(event) => {
                setApprovalEnabled(event.target.checked);
                setApprovalAcknowledged(false);
              }}
            />
            <span>
              <strong>Keep the last accepted catalog beyond six hours</strong>
              <small>
                Enable this only when a provider-granted exception covers the
                older public display. Visitors see the actual update time and a
                stale state; the private reference never leaves Studio.
              </small>
            </span>
          </label>

          {approvalEnabled || approval ? (
            <>
              <label className={styles.formField} htmlFor="discogs-approval-reference">
                <span>Permission reference · owner-only</span>
                <input
                  id="discogs-approval-reference"
                  type="text"
                  value={approvalReference}
                  minLength={1}
                  maxLength={512}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={pending !== null}
                  onChange={(event) => setApprovalReference(event.target.value)}
                  placeholder="Agreement, case, or correspondence reference"
                  required
                />
              </label>
              <label className={styles.formField} htmlFor="discogs-approval-expiry">
                <span>Permission expiry · optional</span>
                <input
                  id="discogs-approval-expiry"
                  type="datetime-local"
                  value={approvalExpiresAt}
                  disabled={pending !== null}
                  onChange={(event) => setApprovalExpiresAt(event.target.value)}
                />
              </label>
            </>
          ) : null}

          {approvalEnabled ? (
            <label className={styles.publicationAcknowledgement}>
              <input
                type="checkbox"
                checked={approvalAcknowledged}
                disabled={pending !== null}
                onChange={(event) =>
                  setApprovalAcknowledged(event.target.checked)
                }
              />
              <span>
                I confirm this permission covers public display beyond the
                standard six-hour window.
              </span>
            </label>
          ) : null}

          <div className={styles.formActions}>
            <button type="submit" disabled={pending !== null}>
              {pending === "approval" ? "Saving…" : "Save permission record"}
            </button>
          </div>
        </form>
      ) : null}

      {message ? (
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
      {config?.publishCollection ? (
        <p className={styles.publicStreamLink}>
          <a href="/play/collect" rel="noreferrer" target="_blank">
            View the published Collect stream
          </a>
        </p>
      ) : null}
      <p className={styles.spotifyIsolationNote}>
        {environment === "local"
          ? "Local authorization, snapshots, and publication choice stay on this machine. Discogs is excluded from the production handoff."
          : "This public-display decision is independent of local Studio. Disconnecting deletes the credential, catalog, and publication choice."}
      </p>
    </section>
  );
}

function discogsPublicCutoff(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 6 * 60 * 60 * 1000).toISOString()
    : null;
}

function discogsApprovalIsActive(
  approval: DiscogsExtendedDisplayApproval | null,
): boolean {
  if (!approval?.enabled) return false;
  const approvedAt = Date.parse(approval.approvedAt);
  if (!Number.isFinite(approvedAt) || approvedAt > Date.now()) return false;
  return approval.expiresAt === null || Date.parse(approval.expiresAt) > Date.now();
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const local = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
