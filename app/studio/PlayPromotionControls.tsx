"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./studio.module.css";

type Provider = "hardcover" | "steam" | "strava";

type Promotion = {
  id: string;
  status: "staged" | "applying" | "applied";
  providers: Provider[];
  createdAt: string;
  expiresAt: string;
};

type ApiResult = {
  code?: string;
  error?: string;
  expiresAt?: string;
  id?: string;
  outcomes?: Array<{
    provider: Provider;
    status: "applied" | "failed";
    itemCount?: number;
    code?: string;
  }>;
  promotions?: Promotion[];
  providers?: Provider[];
  status?: string;
  targetOrigin?: string;
};

const providerLabels: Record<Provider, string> = {
  hardcover: "Hardcover",
  steam: "Steam",
  strava: "Strava",
};

async function responseJson(response: Response): Promise<ApiResult> {
  try {
    return (await response.json()) as ApiResult;
  } catch {
    return {};
  }
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "soon";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

export function PlayPromotionControls({
  environment,
}: {
  environment: "local" | "hosted";
}) {
  const [transferCode, setTransferCode] = useState("");
  const [issued, setIssued] = useState<{
    code: string;
    expiresAt: string;
    targetOrigin: string;
  } | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  const loadPromotions = useCallback(async (): Promise<void> => {
    if (environment !== "hosted") return;
    try {
      const response = await fetch("/api/studio/play-promotion", {
        cache: "no-store",
      });
      const result = await responseJson(response);
      if (response.ok && Array.isArray(result.promotions)) {
        setPromotions(result.promotions);
      }
    } catch {
      // The explicit actions below still surface a useful status.
    }
  }, [environment]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadPromotions();
    });
    return () => {
      active = false;
    };
  }, [loadPromotions]);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  async function issueCode(): Promise<void> {
    setPending("issue");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/play-promotion/start", {
        method: "POST",
      });
      const result = await responseJson(response);
      if (
        !response.ok ||
        !result.code ||
        !result.expiresAt ||
        !result.targetOrigin
      ) {
        setMessage(result.error ?? "A one-time transfer code could not be created.");
        return;
      }
      setIssued({
        code: result.code,
        expiresAt: result.expiresAt,
        targetOrigin: result.targetOrigin,
      });
      setMessage(
        "Code created. Paste it into the local Studio before it expires; it can be used only once.",
      );
    } catch {
      setMessage("A one-time transfer code could not be created.");
    } finally {
      setPending(null);
    }
  }

  async function copyCode(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setMessage("One-time transfer code copied.");
    } catch {
      setMessage("Copy was blocked. Select the code and copy it manually.");
    }
  }

  async function sendLocal(): Promise<void> {
    setPending("send");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/play-promotion/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transferCode }),
      });
      const result = await responseJson(response);
      if (!response.ok || result.status !== "staged") {
        const fallback =
          result.status === "no_credentials"
            ? "No portable local settings were found. Connect Hardcover, Steam, or Strava locally first."
            : result.status === "invalid_code"
              ? "The code is invalid, expired, or does not match the configured production origin."
              : "Production did not accept the transfer. Create a fresh code there and try again.";
        setMessage(result.error ?? fallback);
        return;
      }
      const labels = (result.providers ?? []).map((provider) => providerLabels[provider]);
      setTransferCode("");
      setMessage(
        `${labels.join(", ")} staged in production. Return to production Studio to review and apply them. MyAnimeList, Spotify, and Discogs still require separate production OAuth.`,
      );
    } catch {
      setMessage("The local server could not reach the configured production origin.");
    } finally {
      setPending(null);
    }
  }

  async function applyPromotion(promotion: Promotion): Promise<void> {
    setPending(promotion.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/studio/play-promotion/${encodeURIComponent(promotion.id)}/apply`,
        { method: "POST" },
      );
      const result = await responseJson(response);
      if (!response.ok || result.status !== "complete") {
        setMessage(result.error ?? "The staged settings could not be applied.");
        return;
      }
      const outcomes = result.outcomes ?? [];
      const applied = outcomes
        .filter((outcome) => outcome.status === "applied")
        .map((outcome) =>
          `${providerLabels[outcome.provider]}${typeof outcome.itemCount === "number" ? ` (${outcome.itemCount.toLocaleString()} items)` : ""}`,
        );
      const failed = outcomes
        .filter((outcome) => outcome.status === "failed")
        .map((outcome) => providerLabels[outcome.provider]);
      setMessage(
        `${applied.length ? `Applied: ${applied.join(", ")}.` : "No provider was applied."}${failed.length ? ` Kept existing production state for: ${failed.join(", ")}.` : ""}`,
      );
      await loadPromotions();
    } catch {
      setMessage("The staged settings could not be applied.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.promotionPanel} aria-labelledby="promotion-title">
      <div className={styles.promotionIntro}>
        <p className={styles.eyebrow}>Local → production</p>
        <h2 id="promotion-title">Promote settings without exposing secrets.</h2>
        <p>
          {environment === "local"
            ? "Paste a one-time code from production. This local server sends portable provider settings directly over HTTPS; the browser never receives those credentials."
            : "Create a short-lived code for the local Studio, then review the staged provider names here before production validates and re-encrypts them."}
        </p>
      </div>

      {environment === "local" ? (
        <form
          className={styles.promotionForm}
          onSubmit={(event) => {
            event.preventDefault();
            void sendLocal();
          }}
        >
          <label htmlFor="play-promotion-code">
            <span>One-time production code</span>
            <input
              id="play-promotion-code"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={transferCode}
              onChange={(event) => setTransferCode(event.target.value)}
              minLength={80}
              maxLength={4096}
              required
            />
          </label>
          <button type="submit" disabled={pending !== null}>
            {pending === "send" ? "Sending securely…" : "Stage in production"}
          </button>
          <p>
            Transfers Hardcover, Steam, and the saved Strava profile/embed only.
            Local snapshots and the local encryption key never leave this machine.
          </p>
        </form>
      ) : (
        <div className={styles.promotionHosted}>
          <div className={styles.promotionIssue}>
            <button type="button" onClick={() => void issueCode()} disabled={pending !== null}>
              {pending === "issue" ? "Creating…" : "Create one-time transfer code"}
            </button>
            {issued ? (
              <div className={styles.promotionCode}>
                <label htmlFor="issued-play-promotion-code">
                  Code for {issued.targetOrigin} · expires {formatExpiry(issued.expiresAt)}
                </label>
                <div>
                  <input
                    id="issued-play-promotion-code"
                    readOnly
                    value={issued.code}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={() => void copyCode()}>
                    Copy
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles.promotionQueue}>
            <h3>Staged for review</h3>
            {promotions.filter((promotion) => promotion.status !== "applied").length ? (
              <ul>
                {promotions
                  .filter((promotion) => promotion.status !== "applied")
                  .map((promotion) => (
                    <li key={promotion.id}>
                      <span>
                        {promotion.providers.map((provider) => providerLabels[provider]).join(" · ")}
                      </span>
                      <small>
                        {promotion.status === "staged"
                          ? `Review by ${formatExpiry(promotion.expiresAt)}`
                          : "Validation in progress"}
                      </small>
                      <button
                        type="button"
                        disabled={pending !== null || promotion.status !== "staged"}
                        onClick={() => void applyPromotion(promotion)}
                      >
                        {pending === promotion.id ? "Validating…" : "Validate and apply"}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No local provider settings are waiting for review.</p>
            )}
          </div>
          <p className={styles.promotionBoundary}>
            MyAnimeList, Spotify, and Discogs are intentionally excluded.
            Authorize each separate production app in its connector panel.
          </p>
        </div>
      )}

      {message ? (
        <p className={styles.promotionMessage} role="status" tabIndex={-1} ref={messageRef}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
