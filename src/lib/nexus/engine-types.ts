/** Contract between the orchestrator (browser or tests) and engine executors (server). */
import type { EngineId, FetchStatus, SearchHit, Task } from "./schema";
import type { PageExtraction } from "./extract";

export interface PageRead {
  url: string;
  finalUrl: string;
  fetchStatus: FetchStatus;
  httpStatus: number | null;
  reason: string;
  fetchedAt: string;
  contentHash?: string;
  extraction?: PageExtraction;
  /** Facts proposed by the LLM gateway; each quote was verified verbatim against page text server-side. */
  llmFacts?: LlmFact[];
  synthetic: boolean;
}

export interface LlmFact {
  subject: string;
  subjectType: "person" | "business" | "school" | "organisation";
  predicate: "founded" | "owns" | "works_at" | "holds_position" | "associated_with";
  object: string;
  objectType: "business" | "school" | "organisation";
  role?: string;
  quote: string;
}

export interface ProfileHit {
  site: string;
  url: string;
  username: string;
  note: string;
}

export interface OsintEvent {
  type: string;
  value: string;
  module: string;
}

export interface ResearchOutput {
  report: string;
  sources: { url: string; title: string; excerpt: string }[];
  failed: { url: string; reason: string }[];
  queries: string[];
}

export interface QuotaSignal {
  provider: string;
  status: number | null;
  message: string;
  retryAfterSec: number | null;
}

export interface TaskResult {
  taskId: string;
  engine: EngineId;
  status: "done" | "failed" | "blocked" | "quota" | "unavailable" | "pending";
  provider?: string;
  error?: string;
  quota?: QuotaSignal;
  /** Long-running engines (GPT Researcher, SpiderFoot) return a job to poll. */
  job?: { ref: string; pollAfterMs: number };
  hits?: SearchHit[];
  pages?: PageRead[];
  profiles?: ProfileHit[];
  osint?: OsintEvent[];
  research?: ResearchOutput;
  llm?: { calls: number; tokens: number; quota?: QuotaSignal };
  notes?: string[];
  synthetic?: boolean;
}

export interface ExecuteRequest {
  task: Pick<Task, "id" | "engine" | "kind" | "input" | "jobRef">;
  context: {
    synthetic: boolean;
    clueNames: string[];
    places: string[];
    organisationHints: string[];
    llm: { enabled: boolean; remainingCalls: number; maxTokensPerCall: number };
  };
}

export interface EngineStatus {
  id: EngineId;
  label: string;
  available: boolean;
  mode: "synthetic" | "operator" | "hosted";
  reason: string;
  upstream: string;
  license: string;
  integration: string;
}

export interface EnginesResponse {
  hosted: boolean;
  synthetic: boolean;
  engines: EngineStatus[];
  llm: { available: boolean; reason: string; models: string[]; policy: string };
}
