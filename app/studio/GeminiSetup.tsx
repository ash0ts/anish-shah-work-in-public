"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./studio.module.css";

type Configuration = {
  revision: number;
  keyStored: boolean;
  tested: boolean;
  enabled: boolean;
  testing: boolean;
  model: string;
};
type Permission = {
  provider: string;
  revision: number;
  enabled: boolean;
  active: boolean;
  gameDisplayActive: boolean;
  approvedAt: string;
  expiresAt: string | null;
  referenceStored: boolean;
  purposes: Array<"game_display" | "google_gemini_processing">;
};
const providers = ["myanimelist", "hardcover", "spotify", "discogs", "steam"];
const errors: Record<string, string> = {
  revision_conflict:
    "This panel changed in another tab. Review the current state and try again.",
  key_invalid:
    "The key format is invalid. Paste the key from Google AI Studio.",
  test_required: "Test the saved key before enabling owner preview.",
  test_in_progress:
    "A connection test is already running. Wait for its result.",
  setup_required:
    "Local encryption or session setup is missing. Run npm run setup:local and restart.",
};
export function GeminiSetup() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [access, setAccess] = useState<{
    revision: number;
    passwordStored: boolean;
    enabled: boolean;
  } | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function refresh() {
    const response = await fetch("/api/studio/simulation/configuration", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("load");
    const data = await response.json();
    setConfig(data.configuration);
    setPermissions(data.permissions);
    setAccess(data.access);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/studio/simulation/configuration", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("load");
        return response.json();
      })
      .then((data) => {
        setConfig(data.configuration);
        setPermissions(data.permissions);
        setAccess(data.access);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage(
            "4N1SH setup could not load. Retry after checking local setup.",
          );
      });
    return () => controller.abort();
  }, []);
  async function mutate(
    path: string,
    body: unknown,
    revision: number,
    method = "PUT",
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/studio/simulation/${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "if-match": String(revision),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(
          errors[data.code] ??
            "The change was not saved. Check setup and try again.",
        );
        await refresh();
        return false;
      }
      if (data.configuration) setConfig(data.configuration);
      else await refresh();
      setMessage(
        data.access
          ? "Invitation updated. Previous guest sessions were revoked."
          : data.test === "passed"
            ? "Connection verified. Enable owner preview when ready."
            : data.test === "failed"
              ? "The connection test failed. Check the key, model access, and billing, then test again."
              : data.test === "budget"
                ? "The daily model budget is used. Test again tomorrow."
                : "Saved. Public access has not changed.",
      );
      return true;
    } catch {
      setMessage(
        "The request could not finish. Check the current state before retrying.",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    const form = event.currentTarget;
    const key = String(new FormData(form).get("key") ?? "").trim();
    if (await mutate("configuration", { key }, config.revision)) form.reset();
  }
  const permissionForm = (provider: string) => {
    const record = permissions.find(
      (permission) => permission.provider === provider,
    );
    return (
      <details key={provider}>
        <summary>
          {provider} ·{" "}
          {record?.gameDisplayActive ? "Game allowed" : "Game private"} ·{" "}
          {record?.active ? "Gemini allowed" : "Not shared with Google"}
        </summary>
        {record?.enabled ? (
          <button
            disabled={busy}
            type="button"
            onClick={() =>
              void mutate(
                "google-permissions",
                {
                  provider,
                  approvedAt: record.approvedAt,
                  expiresAt: record.expiresAt,
                  enabled: false,
                  purposes: record.purposes,
                },
                record.revision,
              )
            }
          >
            Stop sharing this collection
          </button>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            void mutate(
              "google-permissions",
              {
                provider,
                reference: String(values.get("reference") ?? ""),
                approvedAt: `${values.get("approvedAt")}T00:00:00.000Z`,
                expiresAt: values.get("expiresAt")
                  ? `${values.get("expiresAt")}T23:59:59.999Z`
                  : null,
                enabled: true,
                purposes: [
                  values.has("game") ? "game_display" : null,
                  values.has("google") ? "google_gemini_processing" : null,
                ].filter(Boolean),
              },
              record?.revision ?? 0,
            ).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <label>
            Private permission reference covering the selected uses
            <input
              name="reference"
              type="password"
              autoComplete="off"
              required
              maxLength={512}
            />
          </label>
          <label>
            <input
              type="checkbox"
              name="game"
              defaultChecked={record?.purposes.includes("game_display")}
            />{" "}
            Display saved items in the game
          </label>
          <label>
            <input
              type="checkbox"
              name="google"
              defaultChecked={record?.purposes.includes(
                "google_gemini_processing",
              )}
            />{" "}
            Send bounded selected items to Google / Gemini
          </label>
          <label>
            Approval date
            <input
              name="approvedAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
          <label>
            Expiry, optional
            <input name="expiresAt" type="date" />
          </label>
          <button disabled={busy} type="submit">
            Save reviewed uses
          </button>
        </form>
      </details>
    );
  };
  return (
    <section className={styles.section} aria-labelledby="gemini-setup-title">
      <div className={styles.sectionIntro}>
        <p>Owner preview</p>
        <h2 id="gemini-setup-title">4N1SH</h2>
        <p>
          Save a Gemini key, test it with a synthetic request, then enable the
          private conversation. This does not activate public AI.
        </p>
      </div>
      {config ? (
        <div>
          <fieldset>
            <legend>Private network access</legend>
            <p>
              {access?.enabled
                ? "Password required. Changing it revokes every existing invitation session."
                : "Set an invitation password before sharing this preview."}{" "}
              Studio still requires owner sign-in. Invited guests get archive
              exploration; live Gemini remains owner-only until audience and
              processing review.
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!access) return;
                const form = event.currentTarget;
                const password = String(
                  new FormData(form).get("password") ?? "",
                );
                if (await mutate("access", { password }, access.revision))
                  form.reset();
              }}
            >
              <label>
                {access?.passwordStored
                  ? "Replace invitation password"
                  : "Invitation password"}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={16}
                  maxLength={128}
                  required
                />
              </label>
              <p>
                Use a unique passphrase of at least 16 characters. It is hashed,
                never returned, and grants access for one hour.
              </p>
              <button disabled={busy || !access}>
                Save invitation password
              </button>
            </form>
            {access?.passwordStored && (
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    "access",
                    { enabled: !access.enabled },
                    access.revision,
                  )
                }
              >
                {access.enabled
                  ? "Lock all invitations"
                  : "Reopen password access"}
              </button>
            )}
          </fieldset>
          {!config.keyStored ? (
            <form onSubmit={saveKey}>
              <label>
                Gemini API key
                <input
                  name="key"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={20}
                  maxLength={256}
                />
              </label>
              <button disabled={busy} type="submit">
                Save Gemini key
              </button>
            </form>
          ) : !config.tested ? (
            <button
              disabled={busy || config.testing}
              type="button"
              onClick={() => void mutate("test", {}, config.revision, "POST")}
            >
              Test connection
            </button>
          ) : !config.enabled ? (
            <button
              disabled={busy}
              type="button"
              onClick={() =>
                void mutate("configuration", { enabled: true }, config.revision)
              }
            >
              Enable owner preview
            </button>
          ) : (
            <Link href="/simulation" prefetch={false}>
              Open owner preview ↗
            </Link>
          )}
          <details>
            <summary>Advanced / recovery</summary>
            <p>
              Model: {config.model}. One test uses one model call. No portfolio
              or visitor text is included in that test.
            </p>
            <p>
              Only use a key and paid-service configuration approved for this
              owner preview. Public-display permission is not Google-processing
              permission. Strava and Travel are excluded.
            </p>
            <form onSubmit={saveKey}>
              <label>
                Replace Gemini key
                <input
                  name="key"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={20}
                  maxLength={256}
                />
              </label>
              <button disabled={busy} type="submit">
                Save replacement
              </button>
            </form>
            {config.enabled ? (
              <button
                disabled={busy}
                type="button"
                onClick={() =>
                  void mutate(
                    "configuration",
                    { enabled: false },
                    config.revision,
                  )
                }
              >
                Disable owner preview
              </button>
            ) : null}
            <h3>Saved collections in 4N1SH</h3>
            <p>
              Game display and Google processing require separate, explicit
              permission. Spotify requires written authorization covering these
              uses; its standard policy does not permit them. Existing
              public-display and summary-only permissions do not grant these
              uses. References are encrypted and never returned. Replacing
              connection credentials requires a new review.
            </p>
            {providers.map(permissionForm)}
          </details>
        </div>
      ) : (
        <button
          type="button"
          onClick={() =>
            void refresh().catch(() => setMessage("Setup remains unavailable."))
          }
        >
          Retry setup
        </button>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
