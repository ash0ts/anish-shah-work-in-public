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
  type CollectionQueryState,
  type CollectionView,
  type ConnectorState,
  type PreviewFixtureScenario,
  DEFAULT_COLLECTION_QUERY,
} from "./connector-model";
import { GalleryView } from "./CollectionGallery";
import { PatternView } from "./CollectionPattern";
import { PanelHeading, StreamEmpty, StreamStatus } from "./StreamChrome";
import { SITE_COPY } from "@/lib/copy";

export function CollectionStream({
  provider,
  fixture,
  initialState,
  initialQuery = DEFAULT_COLLECTION_QUERY,
  routePath,
}: {
  provider: CollectionProvider;
  fixture?: PreviewFixtureScenario;
  initialState?: ConnectorState<CollectionPayload>;
  initialQuery?: CollectionQueryState;
  routePath?: `/play/${string}`;
}) {
  const [state, setState] = useState<ConnectorState<CollectionPayload>>(
    initialState ?? { status: "idle" },
  );
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<CollectionView>("gallery");
  const [draftQuery, setDraftQuery] = useState(initialQuery.query);
  const [query, setQuery] = useState(initialQuery.query);
  const [filter, setFilter] = useState(initialQuery.filter);
  const [sort, setSort] = useState(initialQuery.sort);
  const [page, setPage] = useState(initialQuery.page);
  const [pageSize, setPageSize] = useState<12 | 24 | 36>(
    initialQuery.pageSize,
  );
  const transitionRoot = useRef<HTMLDivElement>(null);
  const skipInitialRequest = useRef(initialState !== undefined);

  const syncRoute = (next: Partial<CollectionQueryState>) => {
    if (!routePath || typeof window === "undefined") return;
    const resolved = {
      query,
      filter,
      sort,
      page,
      pageSize,
      ...next,
    };
    const parameters = new URLSearchParams();
    if (resolved.query) parameters.set("q", resolved.query);
    if (resolved.filter && resolved.filter !== "all") {
      parameters.set("filter", resolved.filter);
    }
    if (resolved.sort) parameters.set("sort", resolved.sort);
    if (resolved.page > 1) parameters.set("page", String(resolved.page));
    if (resolved.pageSize !== 12) {
      parameters.set("pageSize", String(resolved.pageSize));
    }
    if (fixture) parameters.set("fixture", fixture);
    const search = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${routePath}${search ? `?${search}` : ""}`,
    );
  };

  useEffect(() => {
    if (skipInitialRequest.current) {
      skipInitialRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) parameters.set("q", query);
    if (filter) parameters.set("filter", filter);
    if (sort) parameters.set("sort", sort);
    if (fixture) parameters.set("fixture", fixture);

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
  }, [filter, fixture, page, pageSize, provider, query, sort]);

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
    const nextQuery = draftQuery.trim();
    syncRoute({ query: nextQuery, page: 1 });
    setQuery(nextQuery);
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
            {SITE_COPY.play["view-overview"]}
          </button>
          <button
            aria-pressed={view === "gallery"}
            onClick={() => setView("gallery")}
            type="button"
          >
            {SITE_COPY.play["view-browse-all"]}
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
            fixture={fixture}
            gallery={gallery}
            onDraftQuery={setDraftQuery}
            onFilter={(value) => {
              syncRoute({ filter: value, page: 1 });
              setFilter(value);
              setPage(1);
            }}
            onPage={(value) => {
              syncRoute({ page: value });
              setPage(value);
            }}
            onPageSize={(value) => {
              syncRoute({ pageSize: value, page: 1 });
              setPageSize(value);
              setPage(1);
            }}
            onSearch={applySearch}
            onSort={(value) => {
              syncRoute({ sort: value, page: 1 });
              setSort(value);
              setPage(1);
            }}
            provider={provider}
            routePath={routePath}
          />
        ) : (
          <div className={styles.galleryUnavailable} aria-live="polite">
            <strong>{SITE_COPY.play["collection-unavailable"]}</strong>
            <p>
              The overview remains available while the searchable collection
              is prepared.
            </p>
            <button onClick={() => setView("pattern")} type="button">
              {SITE_COPY.play["return-overview"]}
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
        profileLabel={
          provider === "myanimelist"
            ? SITE_COPY.play["profile-myanimelist"]
            : provider === "hardcover"
              ? SITE_COPY.play["profile-hardcover"]
              : SITE_COPY.play["profile-steam"]
        }
        profileUrl={payload.profileUrl}
        stale={state.stale}
        syncedAt={payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}
