"use client";

import { useEffect, useState } from "react";
import styles from "./studio.module.css";

const PROVIDERS = [
  ["myanimelist", "Watch · MyAnimeList"],
  ["hardcover", "Read · Hardcover"],
  ["spotify", "Listen · Spotify"],
  ["discogs", "Collect · Discogs"],
  ["steam", "Play · Steam"],
  ["strava", "Move · Strava"],
] as const;

type Provider = (typeof PROVIDERS)[number][0];

type Approval = {
  provider: Provider;
  scopes: Array<"game_display" | "llm_context">;
  reference: string;
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
};

type Draft = {
  reference: string;
  expiresOn: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  reference: "",
  expiresOn: "",
  enabled: false,
};

function draftsFrom(approvals: Approval[]): Record<Provider, Draft> {
  return Object.fromEntries(
    PROVIDERS.map(([provider]) => {
      const approval = approvals.find((candidate) => candidate.provider === provider);
      return [
        provider,
        approval
          ? {
              reference: approval.reference,
              expiresOn: approval.expiresAt?.slice(0, 10) ?? "",
              enabled: approval.enabled,
            }
          : { ...EMPTY_DRAFT },
      ];
    }),
  ) as Record<Provider, Draft>;
}

export function SimulationProviderApprovals() {
  const [drafts, setDrafts] = useState<Record<Provider, Draft>>(() =>
    draftsFrom([]),
  );
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Provider | null>(null);
  const [message, setMessage] = useState(
    "Checking the protected simulation permission register.",
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/studio/simulation/provider-approvals", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          approvals?: Approval[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(body.approvals)) {
          throw new Error(body.error ?? "Permission records could not be read.");
        }
        setDrafts(draftsFrom(body.approvals));
        setMessage(
          "Only enabled, unexpired providers with both scopes can enter model context.",
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(
          error instanceof Error
            ? error.message
            : "Permission records could not be read.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);

  const update = (provider: Provider, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }));
  };

  const save = async (provider: Provider) => {
    const draft = drafts[provider];
    if (!draft.reference.trim()) {
      setMessage("Add an owner-verifiable approval reference before saving.");
      return;
    }
    setPending(provider);
    setMessage(`Saving ${provider} approval.`);
    try {
      const response = await fetch(
        "/api/studio/simulation/provider-approvals",
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider,
            scopes: ["game_display", "llm_context"],
            reference: draft.reference.trim(),
            approvedAt: new Date().toISOString(),
            expiresAt: draft.expiresOn
              ? new Date(`${draft.expiresOn}T23:59:59.000Z`).toISOString()
              : null,
            enabled: draft.enabled,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Approval was not saved.");
      setMessage(
        draft.enabled
          ? `${provider} is approved for game display and model context.`
          : `${provider} was saved but remains disabled.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Approval was not saved.",
      );
    } finally {
      setPending(null);
    }
  };

  const disable = async (provider: Provider) => {
    setPending(provider);
    setMessage(`Disabling ${provider} for the simulation.`);
    try {
      const response = await fetch(
        "/api/studio/simulation/provider-approvals",
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Approval was not disabled.");
      update(provider, { enabled: false });
      setMessage(`${provider} can no longer enter simulation model context.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Approval was not disabled.",
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="simulation-approval-title">
      <div className={styles.sectionIntro}>
        <p className={styles.eyebrow}>Meet Me · permission register</p>
        <h2 id="simulation-approval-title">Decide what the public model may see.</h2>
        <p>
          A Play provider enters the game and Claude context only when its
          permission is documented here, both scopes are granted, and the
          record is enabled and unexpired.
        </p>
      </div>

      <p aria-atomic="true" className={styles.simulationApprovalStatus} role="status">
        {message}
      </p>

      <div className={styles.simulationApprovalGrid} aria-busy={!loaded || undefined}>
        {PROVIDERS.map(([provider, label]) => {
          const draft = drafts[provider];
          const isPending = pending === provider;
          return (
            <fieldset className={styles.simulationApprovalCard} key={provider}>
              <legend>{label}</legend>
              <label>
                Approval reference
                <textarea
                  autoComplete="off"
                  disabled={!loaded || isPending}
                  maxLength={512}
                  onChange={(event) =>
                    update(provider, { reference: event.currentTarget.value })
                  }
                  placeholder="Owner-only agreement, email, ticket, or document reference"
                  rows={3}
                  value={draft.reference}
                />
              </label>
              <label>
                Expiration date · optional
                <input
                  disabled={!loaded || isPending}
                  onChange={(event) =>
                    update(provider, { expiresOn: event.currentTarget.value })
                  }
                  type="date"
                  value={draft.expiresOn}
                />
              </label>
              <label className={styles.simulationApprovalToggle}>
                <input
                  checked={draft.enabled}
                  disabled={!loaded || isPending}
                  onChange={(event) =>
                    update(provider, { enabled: event.currentTarget.checked })
                  }
                  type="checkbox"
                />
                Enable game display and LLM context
              </label>
              <div className={styles.actionRow}>
                <button
                  disabled={!loaded || isPending}
                  onClick={() => void save(provider)}
                  type="button"
                >
                  {isPending ? "Saving…" : "Save approval"}
                </button>
                <button
                  className={styles.quietButton}
                  disabled={!loaded || isPending || !draft.enabled}
                  onClick={() => void disable(provider)}
                  type="button"
                >
                  Disable
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className={styles.simulationApprovalNote}>
        References and approval dates are owner-only. Public health output
        exposes provider names and a one-way approval digest, never the notes.
      </p>
    </section>
  );
}
