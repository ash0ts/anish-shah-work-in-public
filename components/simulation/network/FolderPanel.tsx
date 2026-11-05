"use client";
import type { ActorRefFrom, SnapshotFrom } from "xstate";
import type { Dispatch, SetStateAction } from "react";
import type { networkMachine } from "@/lib/simulation/network/machine";
import {
  PROGRAMS,
  type Program,
  type Battle,
} from "@/lib/simulation/network/battle";
import {
  CATALOG_DOMAINS,
  type CatalogDomain,
  type CatalogPage,
  type Discovery,
} from "@/lib/simulation/network/catalog-contract";
import { PROGRAM_EFFECTS } from "@/lib/simulation/network/characters";
import { SITE_COPY } from "@/lib/copy";
import styles from "./Network.module.css";
const copy = SITE_COPY.simulation;
const domainLabels: Record<CatalogDomain, string> = {
  work: "Workshop",
  myanimelist: "Anime",
  hardcover: "Books",
  steam: "Games",
  spotify: "Tracks",
  discogs: "Records",
};
export function FolderPanel({
  context,
  catalog,
  activeBattle,
  queue,
  setQueue,
  domain,
  load,
  search,
  setSearch,
  loading,
  page,
  synthetic,
  send,
  open,
  close,
}: {
  context: SnapshotFrom<typeof networkMachine>["context"];
  catalog: Discovery[];
  activeBattle: Battle | null;
  queue: Program[];
  setQueue: Dispatch<SetStateAction<Program[]>>;
  domain: CatalogDomain;
  load(domain: CatalogDomain, q?: string, page?: number): Promise<void>;
  search: string;
  setSearch(value: string): void;
  loading: boolean;
  page: CatalogPage;
  synthetic: boolean;
  send: ActorRefFrom<typeof networkMachine>["send"];
  open(type: "INSPECT", id: string): void;
  close(): void;
}) {
  return (
    <div className={styles.folder}>
      <section>
        <h3>{copy["network-program-heading"]}</h3>
        <p>
          Game effects are fictional. Ratings, ranks and playtime never change
          their strength.
        </p>
        <div className={styles.slots}>
          {context.equipped.map((slot, index) => (
            <div key={index} className={styles.slot}>
              <span>0{index + 1}</span>
              <label>
                Program
                <select
                  value={slot.program}
                  onChange={(e) =>
                    send({
                      type: "EQUIP",
                      index,
                      program: e.target.value as Program,
                      discoveryId: slot.discoveryId,
                    })
                  }
                >
                  {PROGRAMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <small>
                {catalog.find((item) => item.id === slot.discoveryId)?.title ??
                  "Original program chip"}
              </small>
              <span>Game effect: {PROGRAM_EFFECTS[slot.program]}</span>
            </div>
          ))}
        </div>
        {activeBattle?.outcome === "active" && (
          <fieldset>
            <legend>Choose up to three for this hand</legend>
            {context.equipped.map((slot, index) => (
              <label key={index}>
                <input
                  type="checkbox"
                  checked={queue.includes(slot.program)}
                  onChange={(e) =>
                    setQueue((current) =>
                      e.target.checked
                        ? [...new Set([...current, slot.program])].slice(0, 3)
                        : current.filter((p) => p !== slot.program),
                    )
                  }
                />
                {slot.program}
              </label>
            ))}
            <button
              onClick={() => {
                send({
                  type: "BATTLE",
                  action: { type: "load", programs: queue },
                });
                close();
              }}
            >
              Load hand & resume
            </button>
          </fieldset>
        )}
      </section>
      <section>
        <h3>{copy["network-discoveries"]}</h3>
        <div className={styles.domains}>
          {CATALOG_DOMAINS.map((id) => (
            <button
              key={id}
              aria-pressed={domain === id}
              onClick={() => {
                setSearch("");
                void load(id);
              }}
            >
              {domainLabels[id]}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(domain, search);
          }}
        >
          <label>
            Search saved catalog
            <input
              type="search"
              maxLength={80}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button disabled={loading}>Search</button>
        </form>
        {synthetic && <p>Preview sources · no production collections</p>}
        {loading ? (
          <p role="status">Reading saved catalog…</p>
        ) : page.status !== "ready" ? (
          <p>
            {page.status === "permission_required"
              ? "This collection needs game-display permission in local Studio. No data was loaded."
              : "No accepted collection is available here. Connect and sync explicitly in local Studio."}
          </p>
        ) : (
          <>
            <ul className={styles.catalog}>
              {page.items.map((item) => (
                <li key={item.id}>
                  <button onClick={() => open("INSPECT", item.id)}>
                    <span aria-hidden="true">▣</span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.provenance}
                      {item.stale ? " · Saved snapshot" : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button
                disabled={page.page <= 1}
                onClick={() => void load(domain, search, page.page - 1)}
              >
                Previous
              </button>
              <span>{page.total} discoveries</span>
              <button
                disabled={!page.nextPage}
                onClick={() => void load(domain, search, page.nextPage!)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
