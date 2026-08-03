"use client";

import { animate, stagger } from "animejs";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "../PersonalStreams.module.css";
import {
  loadConnector,
  providerTitles,
  type CollectionPayload,
  type CollectionProvider,
  type CollectionView,
  type ConnectorState,
} from "./connector-model";
import { GalleryView } from "./CollectionGallery";
import { PatternView } from "./CollectionPattern";
import { PanelHeading, StreamEmpty, StreamStatus } from "./StreamChrome";

export function CollectionStream({ provider }: { provider: CollectionProvider }) {
  const [state, setState] = useState<ConnectorState<CollectionPayload>>({
    status: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<CollectionView>("gallery");
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<12 | 24 | 36>(12);
  const transitionRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) parameters.set("q", query);
    if (filter) parameters.set("filter", filter);
    if (sort) parameters.set("sort", sort);

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setBusy(true);
      setState((current) =>
        current.status === "idle" ? { status: "loading" } : current,
      );
      void loadConnector<CollectionPayload>(
        provider,
        parameters,
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setState(next);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    });
    return () => controller.abort();
  }, [filter, page, pageSize, provider, query, sort]);

  const payload = state.status === "ready" ? state.payload : null;
  const gallery = payload?.gallery;

  useLayoutEffect(() => {
    const root = transitionRoot.current;
    if (
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const items = root.querySelectorAll<HTMLElement>("[data-stream-item]");
    const targets = items.length ? items : root;
    const motion = animate(targets, {
      opacity: [0.72, 1],
      translateY: ["0.25rem", 0],
      duration: 220,
      delay: items.length ? stagger(9) : 0,
      ease: "out(3)",
    });
    return () => {
      motion.cancel();
    };
  }, [gallery?.page, gallery?.sort, gallery?.filter, provider, view]);

  if (state.status !== "ready" || !payload) {
    return <StreamEmpty state={state} />;
  }

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(draftQuery.trim());
    setPage(1);
  };

  return (
    <>
      <header className={styles.collectionHeader}>
        <PanelHeading
          title={providerTitles[provider]}
          description={payload.coverage}
        />
        <div
          className={styles.viewSwitch}
          role="group"
          aria-label="Collection view"
        >
          <button
            aria-pressed={view === "pattern"}
            onClick={() => setView("pattern")}
            type="button"
          >
            Pattern
          </button>
          <button
            aria-pressed={view === "gallery"}
            onClick={() => setView("gallery")}
            type="button"
          >
            Gallery
          </button>
        </div>
      </header>

      <div
        aria-busy={busy}
        className={styles.collectionBody}
        ref={transitionRoot}
      >
        {view === "pattern" ? (
          <PatternView payload={payload} provider={provider} />
        ) : gallery?.ready ? (
          <GalleryView
            busy={busy}
            draftQuery={draftQuery}
            gallery={gallery}
            onDraftQuery={setDraftQuery}
            onFilter={(value) => {
              setFilter(value);
              setPage(1);
            }}
            onPage={setPage}
            onPageSize={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            onSearch={applySearch}
            onSort={(value) => {
              setSort(value);
              setPage(1);
            }}
            provider={provider}
          />
        ) : (
          <div className={styles.galleryUnavailable} aria-live="polite">
            <strong>The full collection is preparing its first index.</strong>
            <p>
              The pattern view remains available. Refresh this provider once
              from Studio to publish the searchable gallery.
            </p>
            <button onClick={() => setView("pattern")} type="button">
              Return to pattern
            </button>
          </div>
        )}
      </div>

      {provider === "steam" ? (
        <p className={styles.attribution}>
          Data provided by Steam. This independent site is not affiliated with{" "}
          <a
            href="https://www.valvesoftware.com/"
            rel="noreferrer"
            target="_blank"
          >
            Valve
          </a>
          . Public data is shown as available.
        </p>
      ) : null}
      <StreamStatus
        profileUrl={payload.profileUrl}
        stale={state.stale}
        syncedAt={payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}
