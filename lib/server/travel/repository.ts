/**
 * Stable route-facing Travel persistence facade.
 *
 * The focused modules preserve the existing public contract while keeping
 * trip/place drafts, photos, upload/media state, and publication/KV logic
 * independently reviewable.
 */
export { TravelRepositoryError, type TravelMediaDeletion } from "./repository/shared";
export * from "./repository/trips-places";
export * from "./repository/photos";
export * from "./repository/uploads-media";
export * from "./repository/publication";
