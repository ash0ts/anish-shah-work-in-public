"use client";

import { useId, useState } from "react";
import type {
  ConnectorPublicationApprovalSummary,
  PublicConnectorProvider,
} from "@/lib/server/connectors";
import {
  approvalDateAtStartOfDayUtc,
  approvalExpiryAtEndOfDayUtc,
  connectorApprovalReferenceField,
} from "./publication-approval-form";
import styles from "../studio.module.css";

type Props = {
  provider: PublicConnectorProvider;
  providerLabel: string;
  configurationRevision: string | null;
  approval: ConnectorPublicationApprovalSummary | null;
  missingScopes: string[];
  onUpdated: (message?: string) => Promise<void>;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function permissionStatus(
  approval: ConnectorPublicationApprovalSummary | null,
  missingScopes: string[],
): "Recorded" | "Missing" | "Expired" | "Private" | "Replace legacy record" {
  if (!approval) return "Missing";
  if (approval.source === "legacy_discogs") return "Replace legacy record";
  if (!approval.enabled) return "Private";
  if (!approval.active || missingScopes.length > 0) return "Expired";
  return "Recorded";
}

function approvalCanBeRestored(
  approval: ConnectorPublicationApprovalSummary | null,
): boolean {
  if (!approval || approval.source !== "unified") return false;
  const now = Date.now();
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt =
    approval.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(approval.expiresAt);
  return (
    Number.isFinite(approvedAt) &&
    approvedAt <= now &&
    expiresAt > now &&
    approval.scopes.includes("public_display") &&
    approval.scopes.includes("retain_last_known_good")
  );
}

export function ConnectorPermissionControl({
  provider,
  providerLabel,
  configurationRevision,
  approval,
  missingScopes,
  onUpdated,
}: Props) {
  const headingId = useId();
  const [editing, setEditing] = useState(
    !approval ||
      approval.source === "legacy_discogs" ||
      (!approval.enabled
        ? !approvalCanBeRestored(approval)
        : !approval.active || missingScopes.length > 0),
  );
  const [pending, setPending] = useState<"save" | "private" | "restore" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const status = permissionStatus(approval, missingScopes);
  const needsRenewal =
    status === "Expired" || status === "Replace legacy record";
  const referenceField = connectorApprovalReferenceField(approval?.source ?? null);

  async function savePermission(input: {
    reference?: string;
    approvedAt: string;
    expiresAt: string | null;
    enabled: boolean;
  }): Promise<boolean> {
    if (!configurationRevision) {
      setMessage(
        `${providerLabel} connection state changed. Review this provider before recording permission.`,
      );
      return false;
    }
    const response = await fetch(
      `/api/studio/connectors/${provider}/publication-approval`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          expectedConfigurationRevision: configurationRevision,
          scopes: ["public_display", "retain_last_known_good"],
        }),
      },
    );
    const result = (await response.json()) as { reason?: string };
    if (!response.ok) {
      const failure =
        result.reason === "reference"
          ? `${providerLabel} needs a private permission reference.`
          : result.reason === "stale_configuration"
            ? `${providerLabel} connection changed. Review it and record permission again.`
            : `${providerLabel} permission was not saved.`;
      setMessage(failure);
      if (result.reason === "stale_configuration") {
        await onUpdated(failure);
      }
      return false;
    }
    return true;
  }

  async function submit(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const approvedAt = approvalDateAtStartOfDayUtc(data.get("approvedAt"));
    if (!approvedAt) {
      setMessage("Choose the date permission was confirmed.");
      return;
    }
    const reference = data.get("reference");
    setPending("save");
    setMessage(null);
    try {
      const saved = await savePermission({
        ...(typeof reference === "string" && reference.trim()
          ? { reference: reference.trim() }
          : {}),
        approvedAt,
        expiresAt: approvalExpiryAtEndOfDayUtc(data.get("expiresAt")),
        enabled: true,
      });
      if (saved) {
        setEditing(false);
        const success = `${providerLabel} may be displayed publicly and its saved snapshot may be retained. The reference remains encrypted.`;
        setMessage(success);
        await onUpdated(success);
      }
    } catch {
      setMessage(`${providerLabel} permission was not saved.`);
    } finally {
      setPending(null);
    }
  }

  async function setPublicAccess(enabled: boolean): Promise<void> {
    if (!approval || approval.source !== "unified") {
      setEditing(true);
      return;
    }
    setPending(enabled ? "restore" : "private");
    setMessage(null);
    try {
      const saved = await savePermission({
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        enabled,
      });
      if (saved) {
        const success = enabled
          ? `${providerLabel} public access restored.`
          : `${providerLabel} is private. Its connection and saved snapshot were preserved.`;
        setMessage(success);
        await onUpdated(success);
      }
    } catch {
      setMessage(`${providerLabel} permission was not changed.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.permissionControl} aria-labelledby={headingId}>
      <div className={styles.permissionHeading}>
        <div>
          <p>Public permission</p>
          <h4 id={headingId}>Allow public display and saved snapshots</h4>
        </div>
        <span>{status}</span>
      </div>

      {editing ? (
        <form
          className={styles.permissionForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <p>
            Record where permission was confirmed. This private reference is
            encrypted and cannot be retrieved later.
          </p>
          <label>
            Private reference
            <input
              data-studio-primary-action
              name="reference"
              type="password"
              autoComplete="off"
              maxLength={512}
              required={referenceField.required}
              placeholder={referenceField.placeholder}
            />
            {referenceField.legacyHelp ? (
              <small>{referenceField.legacyHelp}</small>
            ) : null}
          </label>
          <div className={styles.permissionDates}>
            <label>
              Permission confirmed
              <input
                name="approvedAt"
                type="date"
                required
                defaultValue={
                  approval?.active
                    ? approval.approvedAt.slice(0, 10)
                    : todayUtc()
                }
              />
            </label>
            <label>
              Expires · optional
              <input
                name="expiresAt"
                type="date"
                defaultValue={
                  approval?.active && approval.expiresAt
                    ? approval.expiresAt.slice(0, 10)
                    : ""
                }
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <button type="submit" disabled={pending !== null}>
              {pending === "save" ? "Saving…" : "Allow public use"}
            </button>
            {approval ? (
              <button
                className={styles.textButton}
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className={styles.permissionSummary}>
          <p>
            {approval?.enabled
              ? `Recorded ${new Date(approval.approvedAt).toLocaleDateString("en", { dateStyle: "medium" })}${approval.expiresAt ? ` · expires ${new Date(approval.expiresAt).toLocaleDateString("en", { dateStyle: "medium" })}` : " · no expiry"}.`
              : "Public display is off. The connection and saved snapshot remain available in Studio."}
          </p>
          <div className={styles.actionRow}>
            {needsRenewal ? (
              <button
                data-studio-primary-action
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(true)}
              >
                Renew permission
              </button>
            ) : approval?.enabled ? (
              <button
                className={styles.quietButton}
                type="button"
                disabled={pending !== null}
                onClick={() => void setPublicAccess(false)}
              >
                {pending === "private" ? "Making private…" : "Make private"}
              </button>
            ) : (
              <button
                data-studio-primary-action
                type="button"
                disabled={pending !== null || !approvalCanBeRestored(approval)}
                onClick={() => void setPublicAccess(true)}
              >
                {pending === "restore" ? "Restoring…" : "Restore public access"}
              </button>
            )}
            {!needsRenewal ? (
              <button
                className={styles.textButton}
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(true)}
              >
                Renew permission
              </button>
            ) : null}
          </div>
        </div>
      )}

      {message ? (
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
