# Limitations (read before relying on results)

- **NEXUS cannot find everything on the internet.** It sees only what its engines reach: search-engine indexes via SearXNG, pages it is allowed to read, and what SpiderFoot, GPT Researcher and Maigret return. The Coverage tab lists what was not searched or could not be opened.
- **Absence of evidence is not evidence of absence.** An empty result means "not found by these engines with these clues".
- **Respecting access rules means gaps.** Pages disallowed by robots.txt, sign-in-walled platforms (Instagram, Facebook, LinkedIn, X, …), private groups and messages are never accessed. They are listed as *inaccessible*.
- **Names are ambiguous.** Many people share a name. NEXUS never merges people on name alone. Possible matches always need your confirmation, and "confirmed" means *you* decided, not that NEXUS proved it.
- **Relationships are not inferred.** A family or personal relationship is never derived from surnames, photos, proximity or co-occurrence. A link you state stays an unverified hypothesis unless a source documents it.
- **Rule-based extraction is pattern-based.** It reads common page structures (JSON-LD, "Founder: …", "X was founded by …", contact blocks, Indian PIN-code addresses). Unusual layouts can be missed. LLM assistance (if configured) helps, but only quote-verified facts are kept.
- **Transliteration is heuristic.** Tamil and Devanagari variants come from rules and may not match every local spelling. Other scripts are not generated yet.
- **Free tiers run out.** When a provider's free quota is used up, that engine pauses, other engines continue, and nothing switches to a paid service. Results can therefore be partial; the Engines panel and Coverage tab show quota events.
- **Hosted mode is limited.** Only the Page Investigator (plus any publicly reachable SearXNG or gateway) is available. GPT Researcher, SpiderFoot and Maigret are local-only.
- **Browser-run orchestration.** Closing the tab pauses an investigation (resume via the recovery banner). Two tabs on the same browser profile share one autosave slot.
- **Unverified in the build environment:** a live GPT Researcher research run, a live SpiderFoot scan and a real Netlify deployment. The adapters are tested against mock services; FreeLLMAPI was tested as a real server with a mock upstream.
- **Phase 2 features** (monitoring of NEXUS investigations, cloud sync, cloud database) are not implemented.
