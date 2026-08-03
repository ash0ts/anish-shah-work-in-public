import Image from "next/image";
import type { CSSProperties, FormEvent } from "react";
import styles from "../PersonalStreams.module.css";
import type {
  CollectionProvider,
  GalleryItem,
  PublicGallery,
} from "./connector-model";

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
      <form className={styles.galleryTools} onSubmit={onSearch}>
        <label className={styles.gallerySearch}>
          <span>Find a title</span>
          <span>
            <input
              maxLength={80}
              onChange={(event) => onDraftQuery(event.target.value)}
              placeholder="Search this collection"
              type="search"
              value={draftQuery}
            />
            <button type="submit">Search</button>
          </span>
        </label>
        <GallerySelect
          label="Filter"
          onChange={onFilter}
          options={gallery.filters.map((entry) => ({
            value: entry.id,
            label: `${entry.label} · ${entry.count}`,
          }))}
          value={gallery.filter}
        />
        <GallerySelect
          label="Sort"
          onChange={onSort}
          options={gallery.sorts.map((entry) => ({
            value: entry.id,
            label: entry.label,
          }))}
          value={gallery.sort}
        />
        <GallerySelect
          label="Per page"
          onChange={(value) => onPageSize(Number(value) as 12 | 24 | 36)}
          options={[12, 24, 36].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          value={String(gallery.pageSize)}
        />
      </form>

      <div className={styles.gallerySummary} aria-live="polite">
        <span>
          {start}—{end} of {gallery.totalItems.toLocaleString()}
        </span>
        <span>{busy ? "Updating view…" : "Public snapshot"}</span>
      </div>

      {gallery.items.length ? (
        <ol className={styles.atlas} data-provider={provider}>
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
          <strong>No titles match this view.</strong>
          <p>Change the search or filter to return to the collection.</p>
        </div>
      )}

      <nav className={styles.galleryPagination} aria-label="Collection pages">
        <button
          disabled={gallery.page <= 1 || busy}
          onClick={() => onPage(gallery.page - 1)}
          type="button"
        >
          ← Previous
        </button>
        <span>
          Page {gallery.page} of {gallery.totalPages}
        </span>
        <button
          disabled={gallery.page >= gallery.totalPages || busy}
          onClick={() => onPage(gallery.page + 1)}
          type="button"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function GallerySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.gallerySelect}>
      <span>{label}</span>
      <select
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
  const content = (
    <>
      <span className={styles.artwork} data-aspect={item.artwork?.aspect ?? (provider === "steam" ? "square" : "poster")}>
        <span aria-hidden="true" className={styles.artworkFallback}>
          {provider === "steam" ? "PLAY" : provider === "hardcover" ? "READ" : "WATCH"}
        </span>
        {item.artwork ? (
          <Image
            alt=""
            decoding="async"
            height={item.artwork.aspect === "square" ? 480 : 720}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
            src={item.artwork.src}
            unoptimized
            width={480}
          />
        ) : null}
      </span>
      <span className={styles.tileNumber}>{String(index).padStart(2, "0")}</span>
      <strong>{item.title}</strong>
      <span className={styles.tileMeta}>{presentation.meta}</span>
      <span className={styles.measure} aria-label={presentation.measureLabel}>
        <i
          aria-hidden="true"
          style={
            {
              "--measure": `${presentation.measure * 100}%`,
            } as CSSProperties
          }
        />
      </span>
      <small>{presentation.measureLabel}</small>
      {presentation.href ? <b aria-hidden="true">↗</b> : null}
    </>
  );

  return (
    <li data-stream-item>
      {presentation.href ? (
        <a href={presentation.href} rel="noreferrer" target="_blank">
          {content}
        </a>
      ) : (
        <article>{content}</article>
      )}
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
