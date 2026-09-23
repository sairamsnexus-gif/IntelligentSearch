/** Shapes returned by the API and consumed by the UI (client-safe). */
import type { CandidateProfile, DiscoveredAttribute, ResolutionSummary, TargetProfile, Platform } from "@/lib/core/types";
import type { DiffPart } from "@/lib/core/change";

export type UiState =
  | "search_in_progress"
  | "discovery_results"
  | "ask_for_more_information"
  | "person_locked"
  | "error";

export interface SessionProgress {
  phase: "queued" | "planning" | "searching" | "resolving" | "done" | "error";
  iteration: number;
  maxIterations: number;
  planned: number;
  completed: number;
  failed: number;
  categories: Record<string, { planned: number; done: number }>;
  sourcesFound: number;
  potentialMatches: number;
  attributesDiscovered: number;
  log: { t: string; msg: string; level?: "info" | "warn" | "new" }[];
}

export interface CoverageRowView {
  key: string;
  label: string;
  status: "ACTIVE" | "LIMITED" | "UNAVAILABLE" | "DEMO";
  via: string[];
  note: string;
}

export interface QueryRowView {
  id: string;
  iteration: number;
  query: string;
  tier: number;
  category: string;
  channel: string;
  reason: string;
  adapter: string | null;
  status: string;
  resultCount: number;
  error: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface SessionView {
  id: string;
  status: string;
  uiState: UiState;
  input: Record<string, unknown>;
  target: TargetProfile;
  extracted: { attributes: { kind: string; value: string }[]; identifiers: { platform: Platform; handle: string }[]; platformHints: Platform[]; usedAi: boolean } | null;
  purpose: string;
  isDemo: boolean;
  demoReason: string;
  progress: SessionProgress;
  resolution: ResolutionSummary | null;
  candidates: CandidateProfile[];
  unattributed: { resultId: string; url: string; title: string; reason: string }[];
  discovered: DiscoveredAttribute[];
  coverage: CoverageRowView[];
  recentQueries: QueryRowView[];
  personId: string | null;
  error: string | null;
  createdAt: string;
}

export interface EvidenceDocView {
  resultId: string;
  url: string;
  title: string;
  description: string;
  contentText: string;
  sourceEngine: string;
  sourcePlatform: string;
  sourceType: string;
  discoveredAt: string;
  publishedAt: string | null;
  query: string;
  isDemo: boolean;
  signals: { label: string; values: string[] }[];
}

export interface PersonSummaryView {
  id: string;
  publicId: string;
  displayName: string;
  status: string;
  monitoringStatus: string;
  confirmedAttributes: number;
  attributes: number;
  sources: number;
  lastScanAt: string | null;
  nextScanAt: string | null;
  newFindings: number;
  changedFindings: number;
  goneFindings: number;
  isDemo: boolean;
  running: boolean;
  intervalHours: number;
}

export interface PersonAttributeView {
  id: string;
  kind: string;
  value: string;
  state: string;
  note: string | null;
  createdAt: string;
  removedAt: string | null;
}

export interface PersonIdentifierView {
  id: string;
  platform: Platform;
  handle: string;
  url: string | null;
  state: string;
  verifiedAt: string | null;
  createdAt: string;
  removedAt: string | null;
}

export interface PersonSourceView {
  id: string;
  url: string;
  title: string | null;
  sourceType: string;
  sourceName: string;
  platform: string | null;
  monitorMethod: string;
  status: string;
  verificationStatus: string;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  isDemo: boolean;
}

export interface EvidenceView {
  id: string;
  sourceUrl: string;
  sourceType: string;
  sourceName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  title: string;
  summary: string;
  contentSnapshot: string;
  extractedAttributes: Record<string, string[]>;
  verificationStatus: string;
  isDemo: boolean;
}

export interface ChangeView {
  id: string;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  changeType: string;
  detectedAt: string;
  diff: DiffPart[];
  attributeChanges: { kind: string; old: string[]; new: string[] }[];
  summary: string;
  seen: boolean;
  evidenceId: string | null;
}

export interface TimelineView {
  id: string;
  occurredAt: string;
  type: string;
  title: string;
  detail: string | null;
  url: string | null;
  evidenceId: string | null;
  changeId: string | null;
}

export interface PersonDetailView extends PersonSummaryView {
  purpose: string;
  lockedAt: string;
  sessionId: string | null;
  attributesList: PersonAttributeView[];
  identifiers: PersonIdentifierView[];
  sourcesList: PersonSourceView[];
  evidence: EvidenceView[];
  changes: ChangeView[];
  timeline: TimelineView[];
  alerts: { id: string; severity: string; title: string; body: string; createdAt: string; readAt: string | null }[];
  monitoring: { status: string; intervalHours: number; lastRunAt: string | null; nextRunAt: string | null; running: boolean; runCount: number; lastError: string | null; lastSummary: Record<string, number> | null };
}

export interface VerificationReport {
  platform: Platform;
  handle: string;
  url: string | null;
  verdict: "corroborated" | "exists_unlinked" | "not_found" | "not_checked";
  message: string;
  findings: { url: string; title: string; nameMatch: boolean; matched: string[]; conflicts: string[]; isDemo: boolean }[];
  searched: string[];
}
