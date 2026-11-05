"use client";
import type { ActorRefFrom, SnapshotFrom } from "xstate";
import type { networkMachine } from "@/lib/simulation/network/machine";
import {
  PROGRAMS,
  type Program,
  PROGRAM_INFO,
} from "@/lib/simulation/network/battle";
import {
  CATALOG_DOMAINS,
  type CatalogDomain,
  type CatalogPage,
  type Discovery,
} from "@/lib/simulation/network/catalog-contract";
import { SITE_COPY } from "@/lib/copy";
import styles from "./Network.module.css";
import { ChipVisual } from "./ChipVisual";
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
  domain,
  load,
  search,
  setSearch,
  loading,
  page,
  synthetic,
  send,
  open,
}: {
  context: SnapshotFrom<typeof networkMachine>["context"];
  catalog: Discovery[];
  domain: CatalogDomain;
  load(domain: CatalogDomain, q?: string, page?: number): Promise<void>;
  search: string;
  setSearch(value: string): void;
  loading: boolean;
  page: CatalogPage;
  synthetic: boolean;
  send: ActorRefFrom<typeof networkMachine>["send"];
  open(type: "INSPECT", id: string): void;
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
              <ChipVisual
                program={slot.program}
                discovery={catalog.find((item) => item.id === slot.discoveryId)}
              />
              <strong>
                {catalog.find((item) => item.id === slot.discoveryId)?.title ??
                  `${slot.program} / program chip`}
              </strong>
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
              {!slot.discoveryId && (
                <small>Inspect a discovery below to attach its identity.</small>
              )}
              <span>Game effect: {PROGRAM_INFO[slot.program].effect}</span>
            </div>
          ))}
        </div>
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
