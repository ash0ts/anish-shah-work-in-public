"use client";

import { useState } from "react";
import type {
  ConnectorPublicationApprovalOverview,
  PublicConnectorProvider,
} from "@/lib/server/connectors";
import {
  approvalDateAtStartOfDayUtc,
  approvalExpiryAtEndOfDayUtc,
  connectorApprovalReferenceField,
} from "./connectors/publication-approval-form";
import styles from "./studio.module.css";

const labels: Record<PublicConnectorProvider, string> = {
  myanimelist: "MyAnimeList",
  hardcover: "Hardcover",
  spotify: "Spotify",
  discogs: "Discogs",
  steam: "Steam",
  strava: "Strava",
};

export function ConnectorPublicationApprovals({
  initial,
}: {
  initial: ConnectorPublicationApprovalOverview;
}) {
  const [overview, setOverview] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState(
    initial.enforcement.mode === "report_only"
      ? "Report-only: existing providers remain visible while approvals are recorded."
      : "Approval enforcement is active.",
  );

  async function reload() {
    const response = await fetch("/api/studio/connectors/publication-approvals", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.ok) setOverview((await response.json()) as ConnectorPublicationApprovalOverview);
  }

  async function save(provider: PublicConnectorProvider, form: HTMLFormElement) {
    const data = new FormData(form);
    const approvedAt = approvalDateAtStartOfDayUtc(data.get("approvedAt"));
    if (!approvedAt) {
      setMessage(`${labels[provider]} needs an approval date.`);
      return;
    }
    const reference = data.get("reference");
    setPending(provider);
    try {
      const response = await fetch(`/api/studio/connectors/${provider}/publication-approval`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(typeof reference === "string" && reference.trim()
            ? { reference: reference.trim() }
            : {}),
          scopes: ["public_display", "retain_last_known_good"],
          approvedAt,
          expiresAt: approvalExpiryAtEndOfDayUtc(data.get("expiresAt")),
          enabled: data.get("enabled") === "on",
        }),
      });
      const result = (await response.json()) as { reason?: string };
      if (!response.ok) {
        setMessage(result.reason === "reference" ? `${labels[provider]} needs a reference.` : `${labels[provider]} approval was not saved.`);
        return;
      }
      await reload();
      form.reset();
      setMessage(`${labels[provider]} approval saved; its reference remains encrypted and hidden.`);
    } catch {
      setMessage(`${labels[provider]} approval was not saved.`);
    } finally {
      setPending(null);
    }
  }

  async function activate() {
    setPending("activate");
    try {
      const response = await fetch("/api/studio/connectors/publication-approvals/activate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const result = (await response.json()) as { missingProviders?: PublicConnectorProvider[] };
      if (!response.ok) {
        setMessage(`Add approvals for ${(result.missingProviders ?? []).map((provider) => labels[provider]).join(", ") || "every configured provider"}.`);
        return;
      }
      await reload();
      setMessage("Approval enforcement is active.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.approvalPanel} aria-labelledby="publication-approvals-title">
      <div className={styles.sectionIntro}>
        <p className={styles.eyebrow}>Publication approvals</p>
        <h3 id="publication-approvals-title">Record display and retention permission.</h3>
        <p>References are encrypted and never returned by Studio or public APIs.</p>
      </div>
      <p role="status" aria-live="polite">{message}</p>
      <div className={styles.approvalGrid}>
        {overview.providers.map(({ provider, configured, approval, missingScopes }) => {
          const referenceField = connectorApprovalReferenceField(
            approval?.source ?? null,
          );
          return (
          <form className={styles.approvalCard} key={provider} onSubmit={(event) => { event.preventDefault(); void save(provider, event.currentTarget); }}>
            <strong>{labels[provider]}</strong>
            <span>
              {configured ? "Configured" : "Not configured"} ·{" "}
              {approval?.source === "legacy_discogs"
                ? "Legacy approval · replace"
                : approval?.active && missingScopes.length === 0
                  ? "Approved"
                  : approval && !approval.enabled
                    ? "Approval disabled"
                    : approval && !approval.active
                      ? "Approval expired"
                      : approval
                        ? "Approval incomplete"
                        : "Approval missing"}
            </span>
            <label>
              Reference
              <input
                name="reference"
                type="password"
                autoComplete="off"
                required={referenceField.required}
                placeholder={referenceField.placeholder}
              />
              {referenceField.legacyHelp ? (
                <small>{referenceField.legacyHelp}</small>
              ) : null}
            </label>
            <label>Approved<input name="approvedAt" type="date" required defaultValue={approval?.approvedAt.slice(0, 10)} /></label>
            <label>Expires (optional)<input name="expiresAt" type="date" defaultValue={approval?.expiresAt?.slice(0, 10)} /></label>
            <label className={styles.approvalCheckbox}><input name="enabled" type="checkbox" defaultChecked={approval?.enabled ?? true} /> Enabled</label>
            <button type="submit" disabled={pending !== null}>{pending === provider ? "Saving…" : "Save approval"}</button>
          </form>
          );
        })}
      </div>
      {overview.enforcement.mode === "report_only" ? (
        <button type="button" disabled={pending !== null || !overview.activationReady} onClick={() => void activate()}>
          {pending === "activate" ? "Activating…" : "Activate enforcement"}
        </button>
      ) : null}
    </section>
  );
}
