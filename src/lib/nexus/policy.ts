/**
 * Absolute zero-cost policy (client-safe constants; enforced server-side in
 * freellmapi.ts, engines.ts and the legacy adapter registry).
 */
export const ZERO_COST_POLICY = {
  summary: "No paid API calls · no paid fallback · no automatic upgrade · no hidden billing",
  rules: [
    "LLM access only through the operator's own FreeLLMAPI gateway, configured with free-tier providers only. Known commercial LLM endpoints are refused as the gateway URL.",
    "HTTP 429 (rate limit) or 402 (payment required) stops that provider until its reset; NEXUS never switches to another provider to continue.",
    "Every investigation has an LLM call budget, a per-call token cap and a daily call cap (NEXUS_LLM_DAILY_CALL_CAP).",
    "SearXNG, GPT Researcher, SpiderFoot and Maigret are self-hosted open-source services; SpiderFoot runs only key-less modules from an allowlist.",
    "Commercial search APIs (Brave, Serper, Tavily) are excluded — their free tiers sit on paid plans or require a payment card.",
    "No account rotation, shared or leaked keys, or quota circumvention.",
  ],
} as const;

/** Legacy console adapters excluded under the zero-cost policy, with the reason shown in Admin. */
export const EXCLUDED_ADAPTERS: Record<string, string> = {
  brave: "Excluded: Brave Search API free plan requires a payment card on file (zero-cost policy)",
  serper: "Excluded: commercial search API with paid plans (zero-cost policy)",
  tavily: "Excluded: commercial search API with paid plans (zero-cost policy)",
};
