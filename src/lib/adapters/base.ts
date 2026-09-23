import "server-only";
import type { AdapterCapabilities, AdapterContext, AdapterHealth, SourceAdapter } from "./types";
import { health, notConfigured } from "./http";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";

const HEALTH_TTL_MS = 60_000;

/** Shared behaviour: health caching and a consistent isAvailable(). */
export abstract class BaseAdapter implements SourceAdapter {
  abstract name: string;
  abstract label: string;
  abstract description: string;
  abstract capabilities(): AdapterCapabilities;
  abstract isConfigured(): boolean;
  protected abstract probe(): Promise<AdapterHealth>;

  private cached?: { at: number; value: AdapterHealth };

  async healthCheck(force = false): Promise<AdapterHealth> {
    if (!this.isConfigured()) return notConfigured(this.capabilities().requires);
    if (!force && this.cached && Date.now() - this.cached.at < HEALTH_TTL_MS) return this.cached.value;
    let value: AdapterHealth;
    try {
      value = await this.probe();
    } catch (e) {
      value = health("unavailable", e instanceof Error ? e.message.slice(0, 200) : "health check failed");
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const h = await this.healthCheck();
    return h.status === "active" || h.status === "limited";
  }

  search?(query: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]>;
}
