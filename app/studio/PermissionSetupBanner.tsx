"use client";

import { useState } from "react";
import type {
  ConnectorPublicationApprovalOverview,
  PublicConnectorProvider,
} from "@/lib/server/connectors";
import styles from "./studio.module.css";

export const connectorLabels: Record<PublicConnectorProvider, string> = {
  myanimelist: "MyAnimeList",
  hardcover: "Hardcover",
  spotify: "Spotify",
  discogs: "Discogs",
  steam: "Steam",
  strava: "Strava",
};

export function PermissionSetupBanner({
  overview,
  onUpdated,
  onSelectProvider,
}: {
  overview: ConnectorPublicationApprovalOverview;
  onUpdated: (message?: string) => Promise<void>;
  onSelectProvider: (provider: PublicConnectorProvider) => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.enforcement.mode !== "report_only") return null;

  const configured = overview.providers.filter((entry) => entry.configured);
  const missing = configured.filter((entry) => entry.missingScopes.length > 0);
  const readyCount = configured.length - missing.length;

  async function finishSetup(): Promise<void> {
    if (
      !window.confirm(
        "Finish permission setup? From this point forward, every configured provider must have a current permission record before it can appear publicly.",
      )
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/studio/connectors/publication-approvals/activate",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const result = (await response.json()) as {
        missingProviders?: PublicConnectorProvider[];
      };
      if (!response.ok) {
        const labels = (result.missingProviders ?? missing.map((item) => item.provider))
          .map((provider) => connectorLabels[provider])
          .join(", ");
        setMessage(
          `Add public permission for ${labels || "every configured provider"}, then try again.`,
        );
        return;
      }
      const success = "Permission setup complete.";
      setMessage(success);
      await onUpdated(success);
    } catch {
      const uncertain =
        "The response was interrupted. Studio is checking the current permission status.";
      setMessage(uncertain);
      await onUpdated(uncertain);
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className={styles.permissionSetup} aria-labelledby="permission-setup-title">
      <div>
        <p className={styles.eyebrow}>One-time setup</p>
        <h3 id="permission-setup-title">
          Finish permission setup · {readyCount} of {configured.length} ready
        </h3>
        <p>
          Record permission for each connected collection. Future providers stay
          private until their own permission is added.
        </p>
      </div>
      {missing.length > 0 ? (
        <ul aria-label="Collections missing public permission">
          {missing.map(({ provider }) => (
            <li key={provider}>
              <button type="button" onClick={() => onSelectProvider(provider)}>
                {connectorLabels[provider]} · Add permission
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.permissionReady}>Every connected collection is ready.</p>
      )}
      <button
        type="button"
        disabled={pending || !overview.activationReady || configured.length === 0}
        onClick={() => void finishSetup()}
      >
        {pending ? "Finishing setup…" : "Finish permission setup"}
      </button>
      {message ? (
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
