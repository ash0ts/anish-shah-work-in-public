import type {
  TravelPhotoDraft,
  TravelPlaceDraft,
} from "@/types/travel";
import { travelDatabase } from "../runtime";

export type PlaceRow = {
  id: string;
  tripId: string;
  label: string;
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  precision: string;
  publicLat: number;
  publicLng: number;
  sortOrder: number;
  revision: string;
  photoCount?: number;
};

export type PhotoRow = {
  id: string;
  tripId: string;
  placeId: string | null;
  altText: string;
  caption: string | null;
  capturedAt: string | null;
  capturePrecision: string | null;
  width: number;
  height: number;
  sortOrder: number;
  isCover: number | boolean;
  storageKey: string;
  revision: string;
};

export class TravelRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TravelRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export type TravelMediaDeletion = {
  id: string;
  storageKeys: string[];
};

export function mediaDeletionStatement(
  db: D1Database,
  deletion: TravelMediaDeletion,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO travel_media_deletions (
       id, storage_keys_json, status, attempts, created_at, updated_at
     ) SELECT ?, ?, 'pending', 0, ?, ?
     WHERE changes() = 1`,
  ).bind(deletion.id, JSON.stringify(deletion.storageKeys), now, now);
}

export function database(binding: D1Database | null = travelDatabase()): D1Database {
  if (!binding) {
    throw new TravelRepositoryError(
      "database_unavailable",
      "The travel database is not ready.",
      503,
    );
  }
  return binding;
}

export function canonicalIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function revision(): string {
  return crypto.randomUUID();
}

export function mapPlace(row: PlaceRow, photoCount = Number(row.photoCount ?? 0)): TravelPlaceDraft {
  return {
    id: row.id,
    tripId: row.tripId,
    label: row.label,
    countryCode: row.countryCode,
    countryName: row.countryName,
    admin1Code: row.admin1Code,
    admin1Name: row.admin1Name,
    precision: row.precision as TravelPlaceDraft["precision"],
    publicPoint: {
      lat: Number(row.publicLat),
      lng: Number(row.publicLng),
    },
    sortOrder: Number(row.sortOrder),
    photoCount,
    revision: row.revision,
  };
}

export function mapPhoto(row: PhotoRow, tags: string[]): TravelPhotoDraft {
  return {
    id: row.id,
    tripId: row.tripId,
    placeId: row.placeId,
    altText: row.altText,
    caption: row.caption,
    capturedAt: row.capturedAt,
    capturePrecision: row.capturePrecision as TravelPhotoDraft["capturePrecision"],
    width: Number(row.width),
    height: Number(row.height),
    tags,
    sortOrder: Number(row.sortOrder),
    isCover: Boolean(row.isCover),
    previewSrc: `/api/studio/travel/photos/${encodeURIComponent(row.id)}/preview`,
    revision: row.revision,
  };
}
