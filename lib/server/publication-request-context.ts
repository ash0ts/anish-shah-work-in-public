import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedPublicContent } from "./public-content-selector";

type PublicationResolution = {
  database: D1Database | null;
  fallbackStore: KVNamespace | null;
  failClosed: boolean;
  promise: Promise<ResolvedPublicContent>;
};

// Only the async-context carrier is shared. Resolved publications live in a
// fresh request store, never in an isolate-wide or time-based content cache.
const requests = new AsyncLocalStorage<PublicationResolution[]>();

export function withPublicationRequest<T>(operation: () => T): T {
  return requests.run([], operation);
}

export function resolvePublicationForRequest(
  database: D1Database | null,
  fallbackStore: KVNamespace | null,
  failClosed: boolean,
  resolve: () => Promise<ResolvedPublicContent>,
): Promise<ResolvedPublicContent> {
  const request = requests.getStore();
  if (!request) return resolve();
  const existing = request.find(
    (entry) => entry.database === database &&
      entry.fallbackStore === fallbackStore && entry.failClosed === failClosed,
  );
  if (existing) return existing.promise;
  // Store the pending promise before invoking the resolver so concurrent
  // metadata/render consumers share both success and fail-closed rejection.
  const promise = Promise.resolve().then(resolve);
  request.push({ database, fallbackStore, failClosed, promise });
  return promise;
}
