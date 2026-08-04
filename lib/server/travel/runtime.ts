import { previewFixtureRuntime } from "@/lib/deployment-environment";
import {
  runtimeDatabase,
  runtimeImages,
  runtimePublicationKv,
  runtimeTravelMedia,
  runtimeValue,
} from "../runtime-env";
import { travelAtlasEnabled as authoritativeTravelAtlasEnabled } from "../play-experience";

export type TravelR2Object = {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  httpEtag?: string;
};

export type TravelR2Bucket = {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<unknown>;
  get(key: string): Promise<TravelR2Object | null>;
  delete(key: string | string[]): Promise<void>;
};

type TravelImageTransformer = {
  transform(options: {
    width?: number;
    height?: number;
    fit?: "scale-down" | "contain" | "cover";
    rotate?: "auto" | number;
    metadata?: "none";
  }): TravelImageTransformer;
  output(options: {
    format: "image/webp";
    quality?: number;
  }): Promise<{ response(): Response }>;
};

export type TravelImagesBinding = {
  input(value: ReadableStream<Uint8Array>): TravelImageTransformer;
};

export function travelDatabase(): D1Database | null {
  return runtimeDatabase();
}

export function travelPublicationKv(): KVNamespace | null {
  return runtimePublicationKv();
}

export function travelMediaBucket(): TravelR2Bucket | null {
  return runtimeTravelMedia() as unknown as TravelR2Bucket | null;
}

export function travelImagesBinding(): TravelImagesBinding | null {
  return runtimeImages() as unknown as TravelImagesBinding | null;
}

export function travelAtlasEnabled(): boolean {
  return authoritativeTravelAtlasEnabled();
}

export function travelPreviewRuntime(): boolean {
  return previewFixtureRuntime({
    DEPLOYMENT_TIER: runtimeValue("DEPLOYMENT_TIER"),
    PREVIEW_PR_NUMBER: runtimeValue("PREVIEW_PR_NUMBER"),
    SITE_URL: runtimeValue("SITE_URL"),
    PRODUCTION_SITE_URL: runtimeValue("PRODUCTION_SITE_URL"),
    PUBLIC_CONTENT_MODE: runtimeValue("PUBLIC_CONTENT_MODE"),
  });
}
