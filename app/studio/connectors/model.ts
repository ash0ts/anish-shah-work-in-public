import type { ReactNode } from "react";
import type { ConnectorHealth } from "@/lib/server/connectors/repository";

export type Environment = "local" | "hosted";

export type ConnectorControlsProps = {
  connector: ConnectorHealth;
  environment: Environment;
  encryptionConfigured: boolean;
  myAnimeListCallbackUrl: string | null;
  spotifyCallbackUrl: string | null;
  steamStorageCountries: string | null;
};

export type SpotifyPresentationConfig = {
  publishTopTracks: boolean;
  reviewedAt: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
  fallbackEmbed: {
    kind: "track" | "album" | "playlist";
    spotifyId: string;
  } | null;
};

export type ApiResult = {
  authorizationUrl?: string;
  callbackUrl?: string;
  code?: string;
  embedUrl?: string;
  error?: string;
  expiresAt?: string;
  itemCount?: number;
  message?: string;
  profileUrl?: string;
  embedStatus?: "available" | "unavailable";
  status?: string;
  updatedAt?: string;
  config?: SpotifyPresentationConfig;
};

export type ProviderMeta = {
  stream: string;
  title: string;
  requirement: string;
  sources: ReadonlyArray<{
    href: string;
    label: string;
  }>;
  summary: string;
  recovery: string;
};

export type OAuthProvider = "myanimelist" | "spotify";

export type OAuthPanelConfig = {
  provider: OAuthProvider;
  title: "MyAnimeList" | "Spotify";
  startPath: string;
  callbackUrl: string | null;
};

export type ApiConnectorPanelProps = {
  connector: ConnectorHealth;
  environment: Environment;
  encryptionConfigured: boolean;
  meta: ProviderMeta;
  oauth?: OAuthPanelConfig;
  steamStorageCountries?: string | null;
  children?: ReactNode;
};

export type ProviderPanelProps = Omit<
  ConnectorControlsProps,
  "myAnimeListCallbackUrl" | "spotifyCallbackUrl" | "steamStorageCountries"
>;
