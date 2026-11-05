"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import styles from "./network/Network.module.css";
export function NetworkGate({ denied = false }: { denied?: boolean }) {
  const [message, setMessage] = useState(
    denied
      ? "Access was not granted. Check the password, or wait a minute before retrying."
      : "",
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  return (
    <section className={styles.accessGate} aria-labelledby="access-title">
      <span className={styles.kicker}>4N1SH / private preview</span>
      <h1 id="access-title">Invitation required.</h1>
      <p>This network is password protected. Ask Anish for access.</p>
      <form
        method="post"
        action="/api/simulation/access"
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setMessage("");
          const form = event.currentTarget;
          try {
            const response = await fetch("/api/simulation/access", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                password: String(new FormData(form).get("password") ?? ""),
              }),
            });
            form.reset();
            if (response.ok) {
              window.location.replace("/simulation");
              return;
            }
            setMessage(
              response.status === 429
                ? "Too many attempts. Wait a minute, then try again."
                : "Access was not granted. Check the password and try again.",
            );
          } catch {
            setMessage("Could not connect. Try again.");
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <label htmlFor="network-password">Network password</label>
        <input
          id="network-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
        <button disabled={busy}>{busy ? "Checking…" : "Enter network"}</button>
      </form>
      <p role="status">{message}</p>
      <Link href="/work" prefetch={false}>
        Browse public Work ↗
      </Link>
    </section>
  );
}
