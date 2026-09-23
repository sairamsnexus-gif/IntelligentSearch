import "server-only";
import { AdapterError, type AdapterHealth, type AdapterStatus } from "./types";
import { bucketFor } from "@/lib/security/rate-limit";
import type { SearchResult, SourceType } from "@/lib/core/types";
import { backoffMs } from "@/lib/core/schedule";

export interface HttpOptions {
  adapter: string;
  timeoutMs?: number;
  retries?: number;
  /** requests/sec politeness for this provider */
  ratePerSec?: number;
  signal?: AbortSignal;
}

/**
 * Fetch for fixed, operator-configured provider endpoints (never user URLs —
 * those go through safeFetch). Adds timeout, per-provider token bucket and
 * exponential retry on 429/5xx/network errors.
 */
export async function providerFetch(url: string, init: RequestInit, opts: HttpOptions): Promise<Response> {
  const retries = opts.retries ?? 2;
  const bucket = bucketFor(opts.adapter, 3, opts.ratePerSec ?? 1);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await bucket.take();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new AdapterError(opts.adapter, `HTTP ${res.status}`, true, res.status);
        if (attempt < retries) {
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : backoffMs(attempt + 1, 500, 8_000));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e instanceof AdapterError && !e.retryable) throw e;
      if (opts.signal?.aborted) throw new AdapterError(opts.adapter, "aborted");
      if (attempt < retries) {
        await sleep(backoffMs(attempt + 1, 500, 8_000));
        continue;
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  if (lastErr instanceof AdapterError) throw lastErr;
  throw new AdapterError(opts.adapter, lastErr instanceof Error ? lastErr.message : "request failed", true);
}

export async function providerJson<T>(url: string, init: RequestInit, opts: HttpOptions): Promise<T> {
  const res = await providerFetch(url, init, opts);
  if (!res.ok) throw new AdapterError(opts.adapter, `HTTP ${res.status}`, false, res.status);
  return (await res.json()) as T;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function makeResult(p: Partial<SearchResult> & { url: string; title: string; sourceEngine: string; query: string }): SearchResult {
  return {
    id: crypto.randomUUID(),
    sourcePlatform: p.sourcePlatform ?? hostPlatform(p.url),
    description: "",
    discoveredAt: new Date().toISOString(),
    emails: [],
    phoneNumbers: [],
    contentText: "",
    rawMetadata: {},
    sourceType: p.sourceType ?? guessType(p.url),
    ...p,
  } as SearchResult;
}

export function hostPlatform(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.endsWith("linkedin.com")) return "linkedin";
    if (h.endsWith("instagram.com")) return "instagram";
    if (h.endsWith("facebook.com")) return "facebook";
    if (h === "x.com" || h === "twitter.com") return "x";
    if (h.endsWith("youtube.com") || h === "youtu.be") return "youtube";
    if (h.endsWith("github.com")) return "github";
    if (h.endsWith("reddit.com")) return "reddit";
    return "web";
  } catch {
    return "web";
  }
}

export function guessType(url: string): SourceType {
  const p = hostPlatform(url);
  if (/\.pdf($|\?)/i.test(url)) return "document";
  if (p === "youtube") return /watch/.test(url) ? "video" : "profile";
  if (p === "reddit") return /\/comments\//.test(url) ? "post" : "profile";
  if (p === "github") return url.split("/").filter(Boolean).length > 3 ? "repository" : "profile";
  if (["linkedin", "instagram", "facebook", "x"].includes(p)) return "profile";
  return "web";
}

export function health(status: AdapterStatus, message: string, latencyMs?: number): AdapterHealth {
  return { status, message, checkedAt: new Date().toISOString(), latencyMs };
}

export function notConfigured(vars: string[]): AdapterHealth {
  return health("not_configured", `Set ${vars.join(" + ")} in .env to enable`);
}

export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
