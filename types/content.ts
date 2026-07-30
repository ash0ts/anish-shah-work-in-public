export type ISODate = `${number}-${number}-${number}`;
export type ISODateTime = `${number}-${number}-${number}T${string}Z`;

export type PublicationState = "public" | "review_required" | "private" | "excluded";
export type VerificationState =
  | "verified"
  | "corroborated"
  | "listed_unconfirmed"
  | "derived"
  | "tentative"
  | "superseded"
  | "excluded";
export type EvidenceAccess = "public_web" | "company_internal" | "owner_private";
export type RelationPredicate =
  | "recording_of"
  | "mirror_of"
  | "translation_of"
  | "derivative_of"
  | "part_of"
  | "implements"
  | "references";
export type CanonicalEntityKind = "work" | "occurrence" | "artifact" | "program";
export type CanonicalCountability = "unique_work" | "representation" | "context";
export type CanonicalSourceBasis = "footprint" | "supplemental" | "mixed" | "synthetic";
export type Practice = "teach" | "build" | "convene";
export type ItemEntityRole =
  | "primary"
  | "recording"
  | "mirror"
  | "translation"
  | "implementation"
  | "component"
  | "reference"
  | "profile";
export type MetricScope =
  | "item"
  | "work"
  | "occurrence"
  | "program"
  | "collection"
  | "portfolio";
export type MetricAttribution = "direct" | "associated" | "contextual";
export type MetricDisplaySurface =
  | "item_detail"
  | "collection"
  | "homepage"
  | "sources";

export type PortfolioItemType =
  | "event"
  | "article"
  | "course"
  | "recording"
  | "technical_report"
  | "external_reference"
  | "producer_credit"
  | "translation"
  | "mirror"
  | "profile"
  | "open_source_repo"
  | "open_source_pr";

export interface Profile {
  id: "person:anish-shah";
  name: string;
  headline: string;
  summary: string;
  primaryCta: { label: string; href: string };
  links: Array<{ label: string; href: string }>;
}

export interface Organization {
  id: string;
  name: string;
}

export interface ContentDate {
  start: string | null;
  end: string | null;
  precision: "day" | "month" | "year" | "unknown";
  basis: "event_date" | "publication_date" | "upload_date" | "unknown";
}

export interface PortfolioItem {
  id: string;
  legacyIds: string[];
  slug: string;
  slugAliases: string[];
  type: PortfolioItemType;
  title: string;
  displayTitle: string;
  shortTitle: string;
  date: ContentDate;
  additionalDates: Array<ContentDate & { label: string }>;
  year: number | null;
  role: string;
  organizationIds: string[];
  location: { label: string; kind: "online" | "physical" | "hybrid" | "platform" | "unknown" };
  status: string;
  urls: Array<{ kind: "primary" | "secondary"; url: string }>;
  summary: string | null;
  topics: string[];
  durationSeconds: number | null;
  publicationState: PublicationState;
  verificationState: VerificationState;
  evidenceIds: string[];
  featured: boolean;
  canonicalEntityId: string;
  entityRole: ItemEntityRole;
  sourceRecord?: {
    snapshotId: string;
    row: number;
    fingerprint: string;
  };
}

export interface CanonicalEntity {
  id: string;
  slug: string;
  slugAliases: string[];
  kind: CanonicalEntityKind;
  title: string;
  displayTitle: string;
  shortTitle: string;
  summary: string;
  practice: Practice;
  representativeDate: ContentDate;
  year: number | null;
  role: string;
  organizationIds: string[];
  topics: string[];
  primaryItemId: string | null;
  itemIds: string[];
  parentEntityIds: string[];
  countability: CanonicalCountability;
  sourceBasis: CanonicalSourceBasis;
  childCounts: {
    items: number;
    occurrences: number;
    artifacts: number;
  };
  publicationState: PublicationState;
  verificationState: VerificationState;
}

export interface ContentSourceSummary {
  footprintRows: number;
  impactRows: number;
  supplementalArtifacts: number;
  publicItems: number;
  footprintBackedUniqueWorks: number;
  supplementalUniqueWorks: number;
}

export interface MetricPeriod {
  start: string | null;
  end: string | null;
  asOf: string | null;
  label: string;
}

export interface ImpactMetricBase {
  id: string;
  subjectId: string;
  category: string;
  key: string;
  label: string;
  qualifier: string | null;
  period: MetricPeriod;
  sourceLabel: string;
  scope: MetricScope;
  attribution: MetricAttribution;
  displaySurfaces: MetricDisplaySurface[];
  publicationState: PublicationState;
  verificationState: VerificationState;
}

export interface OwnerImpactMetric extends ImpactMetricBase {
  value: number | string | boolean;
  unit: string;
  evidenceIds: string[];
  sourceRecord: {
    snapshotId: string;
    row: number;
    fingerprint: string;
  };
}

export interface PublicImpactMetric extends ImpactMetricBase {
  displayValue: string;
  publicEvidenceIds: string[];
}

export type ImpactMetric = OwnerImpactMetric | PublicImpactMetric;

export interface EvidenceSource {
  id: string;
  title: string;
  kind: "web_page" | "video" | "repository" | "profile" | "methodology" | "internal_record";
  access: EvidenceAccess;
  url?: string;
  publisher?: string;
  capturedAt: string;
  verificationState: VerificationState;
}

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  predicate: RelationPredicate;
  confidence: "high" | "medium";
  rationale: string;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  itemIds: string[];
  metricIds: string[];
}

export interface NarrativeBlock {
  id: string;
  title: string;
  body: string;
  placement: "home" | "work" | "play" | "about" | "sources" | "owner_archive";
  publicationState: PublicationState;
  sourceSnapshotId?: string;
}

export interface SourceSnapshot {
  id: string;
  label: string;
  capturedAt: string;
  rowCount: number | null;
  sectionCount: number | null;
  sha256?: string;
  access: EvidenceAccess;
  sourceFile?: string;
}

export interface AnishContentBundle {
  schemaVersion: "1.1";
  contentVersion: string;
  generatedAt: ISODateTime;
  sourceSummary: ContentSourceSummary;
  profile: Profile;
  organizations: Organization[];
  items: PortfolioItem[];
  entities: CanonicalEntity[];
  metrics: ImpactMetric[];
  evidence: EvidenceSource[];
  relations: Relation[];
  collections: Collection[];
  narratives: NarrativeBlock[];
  sourceSnapshots: SourceSnapshot[];
}
