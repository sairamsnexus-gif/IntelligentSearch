/**
 * Adapter contracts. Adapters are the only place that talks to external
 * sources; everything they return is mapped to the canonical SearchResult.
 * One adapter may implement several roles (e.g. GitHub: search + username +
 * monitor).
 */
import type { PlannedQuery, QueryChannel, SearchResult } from "@/lib/core/types";

export type CoverageKey =
  | "web"
  | "news"
  | "reddit"
  | "github"
  | "youtube"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "x"
  | "username"
  | "images"
  | "documents";

export type AdapterStatus = "active" | "limited" | "unavailable" | "disabled" | "not_configured";

export interface AdapterHealth {
  status: AdapterStatus;
  message: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface AdapterCapabilities {
  roles: ("search" | "username" | "monitor")[];
  channels: QueryChannel[];
  /** Coverage this adapter provides natively (not via site: queries). */
  coverage: CoverageKey[];
  cost: "local" | "free" | "free_tier" | "paid";
  /** Env vars required; empty = works out of the box. */
  requires: string[];
  /** Upstream open-source project, when the adapter wraps one. */
  upstream?: string;
}

export interface AdapterContext {
  /** Demo mode only: number of completed monitoring scans (drives demo "world" changes). */
  demoEpoch: number;
  signal?: AbortSignal;
}

export interface CheckResult {
  available: boolean;
  httpStatus: number | null;
  title?: string;
  contentText: string;
  method: string;
  error?: string;
  /** Adapter may skip a check (e.g. robots.txt disallow); not treated as a change. */
  skipped?: boolean;
}

export interface SourceAdapter {
  name: string;
  label: string;
  description: string;
  isDemo?: boolean;
  isConfigured(): boolean;
  capabilities(): AdapterCapabilities;
  healthCheck(): Promise<AdapterHealth>;
  /** Cheap availability test: configured + last health not failing. */
  isAvailable(): Promise<boolean>;

  // SearchAdapter
  search?(query: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]>;
  // UsernameAdapter
  searchUsername?(username: string, ctx: AdapterContext): Promise<SearchResult[]>;
  supportedPlatforms?(): string[];
  // MonitorAdapter
  canMonitor?(url: string): boolean;
  check?(url: string, ctx: AdapterContext): Promise<CheckResult>;
  /** Register a URL with an external monitor (changedetection.io). Returns external ref. */
  monitor?(url: string): Promise<string | null>;
  getChanges?(externalRef: string): Promise<{ changed: boolean; latestText?: string; timestamp?: string }>;
}

export class AdapterError extends Error {
  constructor(
    public adapter: string,
    message: string,
    public retryable = false,
    public status?: number,
  ) {
    super(`[${adapter}] ${message}`);
    this.name = "AdapterError";
  }
}
