# Identity resolution

Implementation: `src/lib/core/extract.ts`, `src/lib/core/resolution.ts`. Pure functions, fully unit-tested.

## Principles

1. **Explainable, not scored by a black box.** Each candidate shows `MATCHES x/y` and a per-attribute ✓ / ✕ / ? with source links.
2. **Never merge on name alone.**
3. **Ambiguity is surfaced, not resolved by guessing.**
4. **A human confirms before anything is locked.**

## 1. Signal extraction (per result)

Deterministic, literal matches only:

- **Name hit** — full name, joined form, reversed order, or first/last with a middle token (`Rajesh K Kumar`). Initial-only variants never count alone.
- **Subject profile** — the result URL *is* a profile (`linkedin.com/in/…`, `github.com/<user>`, `instagram.com/<user>`, `youtube.com/@…`, `x.com/…`, `reddit.com/user/…`).
- **Mentioned profiles** — profile URLs linked from the page.
- Organisations (alias-aware: *Tata Consultancy Services* → TCS), previous organisations (*previously at*, *ex-*, *joined X from Y*), designations, cities/states/countries (gazetteer with aliases), schools, ages, events, emails, phones (libphonenumber), websites.

## 2. Clustering

| Step | Rule |
|---|---|
| Relevance | Keep results with a name hit or an exact target identifier (profile/email/phone). |
| Strong binding | Union-find over **strong keys**: same profile (platform+handle), same email, same phone. Linked profiles bind only when the page names the target and links exactly one handle per platform. |
| Weak attachment | A result without strong keys joins an anchored cluster only if **≥ 2 attributes agree, none conflict, and exactly one cluster qualifies**. Ties are reported as *unattributed* (“matches N candidates equally — not attributed”). |
| Weak candidates | Unattached results with ≥ 2 attributes become single-source candidates flagged *single unlinked source*. |
| Name-only | Everything else is listed under *Unattributed mentions*. |

Candidate keys are stable hashes of the anchoring identifier, so a candidate keeps its key across refinement iterations.

## 3. Matching

For every supplied attribute and identifier:

| Status | Meaning |
|---|---|
| **match** ✓ | Candidate evidence contains an equivalent value (alias/containment aware; age ±3 years). Evidence links attached. |
| **conflict** ✕ | Candidate evidence has a *different* value for that attribute (e.g. Bengaluru vs Chennai; a different LinkedIn handle; your “current company” only appears as a previous employer). |
| **unknown** ? | No evidence either way. |

Additional flags: **exact identifier** (a user-supplied profile/email/phone matched), **corroborated** (≥ 2 strong identifiers, or 1 strong identifier + ≥ 2 independent domains and no conflicts).

The ranking score (used only for ordering) = `10·matched − 15·conflicts + strong-identifier bonus + independent-source bonus − weak penalty`.

## 4. Ambiguity & refinement

- **ambiguous** — two or more conflict-free candidates tie on matched attributes (and on strong-identifier status), the leader has a conflict, or only a name was supplied.
- **leading** — one candidate is ahead. It is still only a *suggestion*; the user must select and confirm.
- **no_candidates** — nothing relevant.

Suggestions rank the attribute kinds the user has not supplied by how much they **discriminate** among the tied candidates (e.g. *Previous company — Candidates differ: Infosys vs HCLTech*).

## 5. Lock

Locking (explicit `confirm: true`) converts the candidate into a person:

| Source | Stored state |
|---|---|
| User-supplied attribute that matched evidence | `confirmed` |
| User-supplied attribute with no evidence | `user_supplied` |
| User-supplied attribute contradicted by evidence | `unverified` (+ note of what was found) |
| Attribute found on the candidate but not supplied | `system_discovered` |
| Candidate profile supplied by the user | `confirmed` identifier |
| Candidate profile not supplied | `system_discovered` identifier |

## 6. Enrichment

`ADD INFORMATION` verifies a new identifier against public sources (username discovery + `site:` search + exact handle search), reports `corroborated / exists_unlinked / not_found`, warns if the identifier belongs to another locked person, and on explicit confirmation adds it to the **same** person (`confirmed` if corroborated, otherwise `user_supplied`). The profile becomes a monitored source and the identifier feeds all future search plans.

## Worked example (demo data)

Input: *Rajesh Kumar · Chennai · India · TCS · Project Manager*

| Candidate | Evidence | Result |
|---|---|---|
| P1 | LinkedIn ↔ GitHub ↔ YouTube ↔ blog cross-linked; news “joined TCS from Infosys” attached (conflicts with P2) | 5/5 |
| P2 | LinkedIn + blog (31-year-old, ex-HCLTech) | 5/5 → **tie → ask** |
| P3 | Senior Software Engineer | 4/5, conflict |
| P4 | Bengaluru | 4/5, conflict |
| Conference page | agrees with P1 and P2 equally | unattributed |

User adds *Previous company = Infosys* → P1 6/6, P2 conflict → **leading**.
