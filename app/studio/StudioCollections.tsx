"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PublicConnectorProvider,
  StudioCollectionsView,
} from "@/lib/server/connectors";
import type { ConnectorHealth } from "@/lib/server/connectors/repository-contracts";
import { ConnectorControls, StravaConnectorControls } from "./ConnectorControls";
import {
  connectorLabels,
  PermissionSetupBanner,
} from "./PermissionSetupBanner";
import { studioConnectorActionLabel } from "./connectors/action-label";
import type { Environment } from "./connectors/model";
import styles from "./studio.module.css";

type Props = {
  initialView: StudioCollectionsView;
  connectors: ConnectorHealth[];
  environment: Environment;
  encryptionConfigured: boolean;
  discogsCallbackUrl: string | null;
  myAnimeListCallbackUrl: string | null;
  spotifyCallbackUrl: string | null;
  steamStorageCountries: string | null;
  initialExpandedProvider: PublicConnectorProvider | null;
};

const callbackProviders = new Set<PublicConnectorProvider>([
  "myanimelist",
  "spotify",
  "discogs",
]);

function requiresIntervention(
  connector: StudioCollectionsView["connectors"][number],
): boolean {
  return connector.primaryAction !== "refresh" && connector.primaryAction !== "none";
}

export function StudioCollections({
  initialView,
  connectors,
  environment,
  encryptionConfigured,
  discogsCallbackUrl,
  myAnimeListCallbackUrl,
  spotifyCallbackUrl,
  steamStorageCountries,
  initialExpandedProvider,
}: Props) {
  const router = useRouter();
  const [expandedProvider, setExpandedProvider] =
    useState<PublicConnectorProvider | null>(initialExpandedProvider);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const pendingFocus = useRef<PublicConnectorProvider | "summary" | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Partial<Record<PublicConnectorProvider, HTMLElement | null>>>(
    {},
  );

  useEffect(() => {
    if (!initialExpandedProvider || !callbackProviders.has(initialExpandedProvider)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current[initialExpandedProvider];
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      row?.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
      row?.querySelector<HTMLElement>("summary")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialExpandedProvider]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const element =
        target === "summary"
          ? summaryRef.current
          : rowRefs.current[target]?.querySelector<HTMLElement>(
              "[data-studio-primary-action]:not(:disabled)",
            ) ?? rowRefs.current[target]?.querySelector<HTMLElement>("summary");
      if (!element) return;
      pendingFocus.current = null;
      element.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialView]);

  const attention = useMemo(
    () => initialView.connectors.filter(requiresIntervention),
    [initialView.connectors],
  );
  const genericByProvider = useMemo(
    () => new Map(connectors.map((connector) => [connector.provider, connector])),
    [connectors],
  );
  const approvals = initialView.approvals;
  const attentionCount = initialView.summary.needsAction;

  async function reloadPermissions(message?: string): Promise<void> {
    if (message) setWorkspaceMessage(message);
    pendingFocus.current = "summary";
    router.refresh();
  }

  async function reloadProvider(
    provider: PublicConnectorProvider,
    message?: string,
  ): Promise<void> {
    if (message) setWorkspaceMessage(message);
    pendingFocus.current = provider;
    router.refresh();
  }

  function selectProvider(provider: PublicConnectorProvider): void {
    setExpandedProvider(provider);
    window.requestAnimationFrame(() => {
      const row = rowRefs.current[provider];
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      row?.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
      row?.querySelector<HTMLElement>("summary")?.focus();
    });
  }

  if (initialView.status !== "ready" || !approvals) {
    return (
      <div className={styles.inlineNotice}>
        <strong>Collections are unavailable.</strong>
        <span>
          Configure the D1 binding and connector encryption key, then reopen
          Studio.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.collectionsWorkspace}>
      <div className={styles.collectionsSummary} ref={summaryRef} tabIndex={-1}>
        <p aria-label={`${initialView.summary.live} live collections; ${attentionCount} need attention`}>
          <strong>{initialView.summary.live} live</strong>
          <span aria-hidden="true"> · </span>
          <span>{attentionCount} {attentionCount === 1 ? "needs" : "need"} attention</span>
        </p>
        <small>Refreshes run only when selected here.</small>
      </div>

      {attention.length > 0 ? (
        <nav className={styles.collectionsActionStrip} aria-label="Collections needing attention">
          {attention.map((connector) => (
            <button
              type="button"
              key={connector.provider}
              onClick={() => selectProvider(connector.provider)}
            >
              <span>{connector.stream} · {connectorLabels[connector.provider]}</span>
              <strong>{studioConnectorActionLabel(connector)}</strong>
            </button>
          ))}
        </nav>
      ) : null}

      <PermissionSetupBanner
        overview={approvals}
        onUpdated={reloadPermissions}
        onSelectProvider={selectProvider}
      />

      <div className={styles.connectorGrid}>
        {initialView.connectors.map((connectorView) => {
          const approvalEntry = approvals.providers.find(
            (entry) => entry.provider === connectorView.provider,
          );
          const common = {
            view: connectorView,
            approvalOverview: approvals,
            expanded: expandedProvider === connectorView.provider,
            onExpandedChange: (expanded: boolean) =>
              setExpandedProvider((current) =>
                expanded
                  ? connectorView.provider
                  : current === connectorView.provider
                    ? null
                    : current,
              ),
            onPermissionUpdated: (message?: string) =>
              reloadProvider(connectorView.provider, message),
          };

          return (
            <div
              key={connectorView.provider}
              ref={(node) => {
                rowRefs.current[connectorView.provider] = node;
              }}
            >
              {connectorView.provider === "strava" ? (
                <StravaConnectorControls
                  environment={environment}
                  approval={approvalEntry?.approval ?? null}
                  missingScopes={approvalEntry?.missingScopes ?? []}
                  {...common}
                />
              ) : (
                <ConnectorControls
                  connector={genericByProvider.get(connectorView.provider)!}
                  environment={environment}
                  encryptionConfigured={encryptionConfigured}
                  discogsCallbackUrl={discogsCallbackUrl}
                  myAnimeListCallbackUrl={myAnimeListCallbackUrl}
                  spotifyCallbackUrl={spotifyCallbackUrl}
                  steamStorageCountries={steamStorageCountries}
                  {...common}
                />
              )}
            </div>
          );
        })}
      </div>
      {workspaceMessage ? (
        <p className={styles.workspaceMessage} role="status" aria-live="polite">
          {workspaceMessage}
        </p>
      ) : null}
    </div>
  );
}
