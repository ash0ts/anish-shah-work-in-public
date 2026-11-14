"use client";

import Image from "next/image";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import styles from "./StreamPresentation.module.css";
import tactile from "./TactileCollections.module.css";
import { TactileDisclosure } from "./TactileDisclosure";
import type {
  CollectionProvider,
  GalleryItem,
  PreviewFixtureScenario,
  PublicGallery,
} from "./connector-model";
import { SITE_COPY } from "@/lib/copy";

export function GalleryView({
  provider,
  gallery,
  busy,
  draftQuery,
  onDraftQuery,
  onSearch,
  onFilter,
  onSort,
  onPageSize,
  onPage,
  routePath,
  fixture,
}: {
  provider: CollectionProvider;
  gallery: PublicGallery<GalleryItem>;
  busy: boolean;
  draftQuery: string;
  onDraftQuery: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onFilter: (value: string) => void;
  onSort: (value: string) => void;
  onPageSize: (value: 12 | 24 | 36) => void;
  onPage: (value: number) => void;
  routePath?: `/play/${string}`;
  fixture?: PreviewFixtureScenario;
}) {
  const start = gallery.totalItems
    ? (gallery.page - 1) * gallery.pageSize + 1
    : 0;
  const end = Math.min(
    gallery.page * gallery.pageSize,
    gallery.totalItems,
  );
  const steamMaximum =
    provider === "steam"
      ? Math.max(
          ...gallery.items.map((item) =>
            "totalHoursRounded" in item ? item.totalHoursRounded : 0,
          ),
          1,
        )
      : 1;

  return (
    <div className={styles.gallery}>
      <nav className={tactile.filters} aria-label="Collection filters">
        {gallery.filters.map((entry) => (
          <a
            key={entry.id}
            aria-current={gallery.filter === entry.id ? "true" : undefined}
            href={galleryPageUrl(routePath ?? `/play/${provider === "myanimelist" ? "watch" : provider === "hardcover" ? "read" : "play"}`, { ...gallery, filter: entry.id }, 1, fixture)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (!busy) onFilter(entry.id);
            }}
          >
            {entry.label}<span>{entry.count.toLocaleString()}</span>
          </a>
        ))}
      </nav>
      <form
        action={routePath}
        className={styles.galleryTools}
        method="get"
        onSubmit={onSearch}
      >
        {fixture ? <input name="fixture" type="hidden" value={fixture} /> : null}
        <label className={styles.gallerySearch}>
          <span>Find a title</span>
          <span>
            <input
              maxLength={80}
              name="q"
              onChange={(event) => onDraftQuery(event.target.value)}
              placeholder={SITE_COPY.play["collection-search-placeholder"]}
              type="search"
              value={draftQuery}
            />
            <button type="submit">Search</button>
          </span>
        </label>
        <GalleryFilterDisclosure>
            <input type="hidden" name="filter" value={gallery.filter} />
            <GallerySelect
              label="Sort"
              name="sort"
              onChange={onSort}
              options={gallery.sorts.map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
              value={gallery.sort}
            />
            <GallerySelect
              label="Per page"
              name="pageSize"
              onChange={(value) => onPageSize(Number(value) as 12 | 24 | 36)}
              options={[12, 24, 36].map((value) => ({
                value: String(value),
                label: String(value),
              }))}
              value={String(gallery.pageSize)}
            />
        </GalleryFilterDisclosure>
      </form>

      <div className={styles.gallerySummary} aria-live="polite">
        <span>
          {start}—{end} of {gallery.totalItems.toLocaleString()}
        </span>
        <span>{busy ? "Loading results…" : SITE_COPY.play["view-browse-all"]}</span>
      </div>

      {gallery.items.length ? (
        <ol className={tactile.collection} data-provider={provider} data-collection-gallery>
          {gallery.items.map((item, index) => (
            <GalleryTile
              index={start + index}
              item={item}
              key={galleryItemKey(item)}
              provider={provider}
              steamMaximum={steamMaximum}
            />
          ))}
        </ol>
      ) : (
        <div className={styles.noResults} data-stream-item>
          <strong>{SITE_COPY.play["collection-no-results-title"]}</strong>
          <p>{SITE_COPY.play["collection-no-results-body"]}</p>
        </div>
      )}

      <nav className={styles.galleryPagination} aria-label="Collection pages">
        {routePath ? (
          <a
            aria-disabled={gallery.page <= 1 || busy}
            href={
              gallery.page <= 1
                ? undefined
                : galleryPageUrl(
                    routePath,
                    gallery,
                    gallery.page - 1,
                    fixture,
                  )
            }
            onClick={(event) => {
              event.preventDefault();
              if (gallery.page > 1 && !busy) onPage(gallery.page - 1);
            }}
          >
            ← Previous
          </a>
        ) : (
          <button
            disabled={gallery.page <= 1 || busy}
            onClick={() => onPage(gallery.page - 1)}
            type="button"
          >
            ← Previous
          </button>
        )}
        <span>
          Page {gallery.page} of {gallery.totalPages}
        </span>
        {routePath ? (
          <a
            aria-disabled={gallery.page >= gallery.totalPages || busy}
            href={
              gallery.page >= gallery.totalPages
                ? undefined
                : galleryPageUrl(
                    routePath,
                    gallery,
                    gallery.page + 1,
                    fixture,
                  )
            }
            onClick={(event) => {
              event.preventDefault();
              if (gallery.page < gallery.totalPages && !busy) {
                onPage(gallery.page + 1);
              }
            }}
          >
            Next →
          </a>
        ) : (
          <button
            disabled={gallery.page >= gallery.totalPages || busy}
            onClick={() => onPage(gallery.page + 1)}
            type="button"
          >
            Next →
          </button>
        )}
      </nav>
    </div>
  );
}

export function GalleryFilterDisclosure({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <details className={styles.galleryFilters}>
      <summary>Filters and sort</summary>
      <div className={styles.galleryFilterFields}>{children}</div>
    </details>
  );
}

function GallerySelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.gallerySelect}>
      <span>{label}</span>
      <select
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function galleryPageUrl(
  routePath: `/play/${string}`,
  gallery: PublicGallery<GalleryItem>,
  page: number,
  fixture?: PreviewFixtureScenario,
) {
  const parameters = new URLSearchParams({
    page: String(page),
    pageSize: String(gallery.pageSize),
  });
  if (gallery.query) parameters.set("q", gallery.query);
  if (gallery.filter && gallery.filter !== "all") {
    parameters.set("filter", gallery.filter);
  }
  if (gallery.sort) parameters.set("sort", gallery.sort);
  if (fixture) parameters.set("fixture", fixture);
  return `${routePath}?${parameters.toString()}`;
}

function GalleryTile({
  provider,
  item,
  index,
  steamMaximum,
}: {
  provider: CollectionProvider;
  item: GalleryItem;
  index: number;
  steamMaximum: number;
}) {
  const presentation = galleryItemPresentation(provider, item, steamMaximum);
  const providerLabel = SITE_COPY.play[provider === "myanimelist" ? "profile-myanimelist" : provider === "hardcover" ? "profile-hardcover" : "profile-steam"];
  return (
    <li data-stream-item>
      <TactileDisclosure kind={provider} summary={
        <>
          <span className={tactile.cover} data-aspect={item.artwork?.aspect ?? (provider === "steam" ? "square" : "poster")}>
            <span aria-hidden="true" className={tactile.coverFallback}>
              <b>{String(index).padStart(2, "0")}</b>
              <span>{provider === "steam" ? "PLAY" : provider === "hardcover" ? "READ" : "WATCH"}</span>
            </span>
            {item.artwork ? <Image alt="" decoding="async" height={item.artwork.aspect === "square" ? 480 : 720} loading="lazy"
              onError={(event) => { event.currentTarget.hidden = true; }} src={item.artwork.src} unoptimized width={480} /> : null}
          </span>
          <strong>{item.title}</strong>
          <small>{presentation.meta}</small>
        </>
      }>
        <p>{presentation.measureLabel}</p>
        <div className={tactile.meter} aria-hidden="true" style={{ "--measure": `${presentation.measure * 100}%` } as CSSProperties}><i /></div>
        {"episodesWatched" in item && item.episodesWatched !== null ? <p>{item.episodesWatched} {SITE_COPY.play["episodes-watched"]}</p> : null}
        {"genres" in item && item.genres?.length ? <p>{item.genres.join(" · ")}</p> : null}
        {presentation.href ? <a href={presentation.href} rel="noreferrer" target="_blank">{providerLabel} ↗</a> : null}
      </TactileDisclosure>
    </li>
  );
}

function galleryItemPresentation(
  provider: CollectionProvider,
  item: GalleryItem,
  steamMaximum: number,
) {
  if (provider === "myanimelist" && "status" in item && "score" in item) {
    const score = item.score ?? 0;
    return {
      href: `https://myanimelist.net/anime/${encodeURIComponent(item.id)}`,
      meta: [item.status, item.releaseYear].filter(Boolean).join(" · "),
      measure: score > 0 ? Math.min(score / 10, 1) : 0,
      measureLabel: score > 0 ? `Score ${score}/10` : "Not scored",
    };
  }
  if (provider === "hardcover" && "status" in item && "rating" in item) {
    const rating = item.rating ?? 0;
    return {
      href: item.slug
        ? `https://hardcover.app/books/${encodeURIComponent(item.slug)}`
        : null,
      meta: item.status,
      measure: rating > 0 ? Math.min(rating / 5, 1) : 0,
      measureLabel: rating > 0 ? `Rating ${rating}/5` : "Not rated",
    };
  }
  const game =
    "appId" in item
      ? item
      : {
          appId: "",
          totalHoursRounded: 0,
          recentHoursRounded: 0,
        };
  return {
    href: game.appId
      ? `https://store.steampowered.com/app/${encodeURIComponent(game.appId)}`
      : null,
    meta:
      game.recentHoursRounded > 0
        ? `${game.recentHoursRounded.toLocaleString()}h recent`
        : "Lifetime playtime",
    measure: Math.min(game.totalHoursRounded / steamMaximum, 1),
    measureLabel: `${game.totalHoursRounded.toLocaleString()} rounded hours`,
  };
}

function galleryItemKey(item: GalleryItem) {
  if ("appId" in item) return `steam:${item.appId}`;
  return `${"rating" in item ? "hardcover" : "mal"}:${item.id}`;
}
