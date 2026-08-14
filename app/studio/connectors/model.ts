import type { ReactNode } from "react";
import type {
  ConnectorPublicationApprovalOverview,
  StudioConnectorView,
} from "@/lib/server/connectors";
import type { ConnectorHealth } from "@/lib/server/connectors/repository";

export type Environment = "local" | "hosted";

export type ConnectorControlsProps = {
  connector: ConnectorHealth;
  view: StudioConnectorView;
  approvalOverview: ConnectorPublicationApprovalOverview;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPermissionUpdated: (message?: string) => Promise<void>;
  environment: Environment;
  encryptionConfigured: boolean;
  myAnimeListCallbackUrl: string | null;
  spotifyCallbackUrl: string | null;
  discogsCallbackUrl: string | null;
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

export type DiscogsPresentationConfig = {
  publishCollection: boolean;
  reviewedAt: string | null;
  updatedAt?: string | null;
};

export type DiscogsExtendedDisplayApproval = {
  provider: "discogs";
  reference: string;
  approvedAt: string;
  expiresAt: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type ApiResult = {
  authorizationUrl?: string;
  callbackUrl?: string;
  checkedAt?: string | null;
  code?: string;
  embedUrl?: string;
  error?: string;
  expiresAt?: string;
  itemCount?: number;
  message?: string;
  profileUrl?: string;
  retryNotBefore?: string;
  embedStatus?: "available" | "unavailable";
  status?: string;
  updatedAt?: string;
  config?: SpotifyPresentationConfig | DiscogsPresentationConfig;
  extendedDisplayApproval?: DiscogsExtendedDisplayApproval | null;
  approval?: DiscogsExtendedDisplayApproval;
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

export type OAuthProvider = "myanimelist" | "spotify" | "discogs";

export type OAuthCredentialShape =
  | {
      idLabel: "Client ID";
      secretLabel: "Client secret";
      requestKeys: {
        id: "clientId";
        secret: "clientSecret";
      };
      showsAccessTokenExpiry: true;
    }
  | {
      idLabel: "Consumer key";
      secretLabel: "Consumer secret";
      requestKeys: {
        id: "consumerKey";
        secret: "consumerSecret";
      };
      showsAccessTokenExpiry: false;
    };

export type OAuthPanelConfig = {
  provider: OAuthProvider;
  title: "MyAnimeList" | "Spotify" | "Discogs";
  startPath: string;
  callbackUrl: string | null;
  credentialShape?: OAuthCredentialShape;
};

export type ApiConnectorPanelProps = Omit<
  ConnectorControlsProps,
  | "myAnimeListCallbackUrl"
  | "spotifyCallbackUrl"
  | "discogsCallbackUrl"
  | "steamStorageCountries"
> & {
  meta: ProviderMeta;
  oauth?: OAuthPanelConfig;
  steamStorageCountries?: string | null;
  children?: ReactNode;
  advancedChildren?: ReactNode;
};

export type ProviderPanelProps = Omit<
  ConnectorControlsProps,
  | "myAnimeListCallbackUrl"
  | "spotifyCallbackUrl"
  | "discogsCallbackUrl"
  | "steamStorageCountries"
>;
