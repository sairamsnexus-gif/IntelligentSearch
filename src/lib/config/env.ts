import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Every provider key is optional; empty strings are
 * normalised to undefined so "configured" checks are a simple truthiness test.
 * This module must never be imported by client components.
 */
const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optStr = z.preprocess(emptyToUndef, z.string().optional());
const optUrl = z.preprocess(emptyToUndef, z.string().url().optional());
const intIn = (def: number, min: number, max: number) =>
  z.preprocess(emptyToUndef, z.coerce.number().int().min(min).max(max).default(def));

const schema = z.object({
  // LLM gateway — FreeLLMAPI (operator-run, single-user). The only LLM path in NEXUS.
  FREELLMAPI_BASE_URL: optUrl,
  FREELLMAPI_API_KEY: optStr,
  FREELLMAPI_MODEL: optStr,
  FREELLMAPI_MODEL_ALLOWLIST: optStr,
  NEXUS_LLM_DAILY_CALL_CAP: intIn(200, 0, 5000),
  NEXUS_LLM_MAX_TOKENS: intIn(1500, 64, 8000),
  // NEXUS engine services (all optional, operator-run)
  GPTR_SERVICE_URL: optUrl,
  SPIDERFOOT_URL: optUrl,
  SPIDERFOOT_USER: optStr,
  SPIDERFOOT_PASSWORD: optStr,
  NEXUS_SYNTHETIC: z.preprocess(emptyToUndef, z.enum(["auto", "true", "false"]).default("auto")),
  // Hosted (Netlify) mode: no database, env-based operator login, operator-only services unreachable.
  NEXUS_HOSTED: z.preprocess(emptyToUndef, z.enum(["true", "false"]).optional()),
  NETLIFY: optStr,
  NEXUS_OPERATOR_EMAIL: optStr,
  NEXUS_OPERATOR_PASSWORD_HASH: optStr,
  TAVILY_API_KEY: optStr,
  BRAVE_SEARCH_API_KEY: optStr,
  SERPER_API_KEY: optStr,
  SEARXNG_URL: optUrl,
  SEARCH_API_URL: optUrl,
  SCRAPER_API_URL: optUrl,
  REDDIT_CLIENT_ID: optStr,
  REDDIT_CLIENT_SECRET: optStr,
  REDDIT_USER_AGENT: z.preprocess(emptyToUndef, z.string().default("IntelligentSearch/1.0")),
  GITHUB_TOKEN: optStr,
  YOUTUBE_API_KEY: optStr,
  MAIGRET_SERVICE_URL: optUrl,
  CHANGEDETECTION_URL: optUrl,
  CHANGEDETECTION_API_KEY: optStr,
  DATABASE_URL: optStr,
  PGLITE_DATA_DIR: z.preprocess(emptyToUndef, z.string().default("./.data/pglite")),
  MONITOR_INTERVAL_HOURS: intIn(24, 1, 24 * 30),
  MAX_DISCOVERY_ITERATIONS: intIn(3, 1, 6),
  MAX_QUERIES_PER_ITERATION: intIn(40, 5, 200),
  SEARCH_CONCURRENCY: intIn(4, 1, 16),
  DEMO_MODE: z.preprocess(emptyToUndef, z.enum(["auto", "true", "false"]).default("auto")),
  AUTH_SECRET: optStr,
  RUN_WORKER_IN_PROCESS: z.preprocess(emptyToUndef, z.enum(["true", "false"]).default("true")),
  APP_ENV: z.preprocess(emptyToUndef, z.enum(["development", "test", "production"]).default("development")),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report which variables are invalid, never their values.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: re-read process.env on next access. */
export function resetEnvCache() {
  cached = null;
}
