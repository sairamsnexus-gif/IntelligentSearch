/**
 * Canonical domain types shared by the planner, adapters, resolution engine,
 * services and UI. Pure types only — safe to import from client components.
 */

export const ATTRIBUTE_KINDS = [
  "name",
  "city",
  "state",
  "country",
  "organization",
  "designation",
  "previous_organization",
  "school",
  "age",
  "email",
  "phone",
  "website",
  "event",
  "other",
] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export const PLATFORMS = [
  "linkedin",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "github",
  "reddit",
  "other_social",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Lifecycle state of an attribute or identifier. */
export const ATTRIBUTE_STATES = ["confirmed", "user_supplied", "system_discovered", "unverified"] as const;
export type AttributeState = (typeof ATTRIBUTE_STATES)[number];

export interface TargetAttribute {
  kind: AttributeKind;
  value: string;
  state: AttributeState;
}

export interface TargetIdentifier {
  platform: Platform;
  /** Username / handle (normalised, lower-case, no @). */
  handle: string;
  url?: string;
  state: AttributeState;
}

/** Everything known about the target that drives search generation and matching. */
export interface TargetProfile {
  name: string;
  attributes: TargetAttribute[];
  identifiers: TargetIdentifier[];
}

export type QueryChannel = "web" | "news" | "github" | "reddit" | "youtube" | "username" | "images";

export type QueryCategory =
  | "name_variation"
  | "company_location"
  | "professional"
  | "social"
  | "news"
  | "images"
  | "documents"
  | "username"
  | "cross_reference"
  | "discovered";

export interface PlannedQuery {
  query: string;
  /** Canonical, order-insensitive key used for de-duplication. */
  key: string;
  tier: number;
  category: QueryCategory;
  channel: QueryChannel;
  reason: string;
  platform?: Platform;
  /** For channel=username / github / reddit: the raw handle. */
  handle?: string;
}

export type SourceType = "profile" | "article" | "post" | "repository" | "video" | "document" | "image" | "web" | "forum";

/** Canonical search result — every adapter maps into this shape. */
export interface SearchResult {
  id: string;
  query: string;
  sourceEngine: string;
  sourcePlatform: string;
  url: string;
  title: string;
  description: string;
  publishedAt?: string | null;
  discoveredAt: string;
  author?: string | null;
  username?: string | null;
  name?: string | null;
  location?: string | null;
  organization?: string | null;
  designation?: string | null;
  emails: string[];
  phoneNumbers: string[];
  imageUrl?: string | null;
  contentText: string;
  rawMetadata: Record<string, unknown>;
  sourceType: SourceType;
  isDemo?: boolean;
}

export interface ProfileRef {
  platform: Platform;
  handle: string;
  url: string;
}

/** Signals extracted from a single result. */
export interface ExtractedSignals {
  nameHit: boolean;
  nameMatchedAs?: string;
  /** Profile that this document *is* (result URL is a profile page). */
  subjectProfile?: ProfileRef;
  /** Profiles linked / mentioned from this document. */
  mentionedProfiles: ProfileRef[];
  emails: string[];
  phones: string[];
  cities: string[];
  states: string[];
  countries: string[];
  organizations: string[];
  previousOrganizations: string[];
  designations: string[];
  schools: string[];
  ages: number[];
  websites: string[];
  events: string[];
}

export type MatchStatus = "match" | "conflict" | "unknown";

export interface AttributeEvidenceRef {
  resultId: string;
  url: string;
  title: string;
  domain: string;
}

export interface AttributeMatch {
  key: string; // e.g. "city" or "platform:linkedin"
  label: string;
  expected: string;
  status: MatchStatus;
  found: string[];
  strong: boolean;
  evidence: AttributeEvidenceRef[];
}

export interface CandidateAttributeValue {
  value: string;
  count: number;
  evidence: AttributeEvidenceRef[];
}

export interface CandidateProfile {
  clusterKey: string;
  displayName: string;
  resultIds: string[];
  /** Which strong keys (profile/email/phone) bound this cluster together. */
  strongKeys: string[];
  weak: boolean;
  attributes: Partial<Record<AttributeKind, CandidateAttributeValue[]>>;
  profiles: (ProfileRef & { evidence: AttributeEvidenceRef[] })[];
  imageUrl?: string | null;
  sourceCount: number;
  evidenceCount: number;
  domains: string[];
  firstDiscoveredAt: string;
  lastCheckedAt: string;
  match: {
    matched: number;
    total: number;
    conflicts: number;
    breakdown: AttributeMatch[];
    strongIdentifierMatch: boolean;
    corroborated: boolean;
    independentSources: number;
    score: number;
  };
}

export type ResolutionState = "no_candidates" | "ambiguous" | "leading";

export interface RefinementSuggestion {
  kind: AttributeKind | `platform:${Platform}`;
  label: string;
  why: string;
}

export interface ResolutionSummary {
  state: ResolutionState;
  message: string;
  candidateCount: number;
  topCandidateKeys: string[];
  suggestions: RefinementSuggestion[];
}

export interface DiscoveredAttribute {
  kind: AttributeKind | `platform:${Platform}`;
  value: string;
  fromCandidate: string;
  evidenceUrl: string;
}

export type ChangeType = "NEW" | "CHANGED" | "UNCHANGED" | "NO_LONGER_AVAILABLE";
