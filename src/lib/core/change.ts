/**
 * Snapshot comparison / change detection (pure). Server code hashes with
 * sha256; this module stays runtime-agnostic by accepting a hash function.
 */
import { diffWordsWithSpace, diffLines } from "diff";
import type { ChangeType } from "./types";

/** Strip markup and volatile whitespace so cosmetic changes don't alert. */
export function normalizeContent(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 200_000);
}

export interface SnapshotLike {
  contentHash: string;
  contentText: string;
  available: boolean;
}

export interface DiffPart {
  op: "add" | "remove" | "same";
  text: string;
}

export interface ChangeResult {
  type: ChangeType;
  diff: DiffPart[];
  summary: string;
}

/** Sentence-ish segmentation gives readable diffs for single-line pages. */
function segment(text: string): string {
  return text.replace(/([.!?])\s+(?=[A-Z0-9])/g, "$1\n") + "\n";
}

export function computeDiff(prev: string, curr: string): DiffPart[] {
  const lines = diffLines(segment(prev), segment(curr));
  const parts: DiffPart[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    // A removed line immediately followed by an added line: show a word-level diff.
    if (l.removed && next?.added) {
      for (const w of diffWordsWithSpace(l.value, next.value)) parts.push({ op: w.added ? "add" : w.removed ? "remove" : "same", text: w.value });
      i++;
      continue;
    }
    parts.push({ op: l.added ? "add" : l.removed ? "remove" : "same", text: l.value });
  }
  return parts;
}

export function compareSnapshots(prev: SnapshotLike | null, curr: SnapshotLike): ChangeResult {
  if (!prev) {
    return curr.available
      ? { type: "NEW", diff: [], summary: "Source first observed" }
      : { type: "NO_LONGER_AVAILABLE", diff: [], summary: "Source unavailable on first check" };
  }
  if (!curr.available) {
    return prev.available
      ? { type: "NO_LONGER_AVAILABLE", diff: [], summary: "Source is no longer available" }
      : { type: "UNCHANGED", diff: [], summary: "Source still unavailable" };
  }
  if (!prev.available) return { type: "CHANGED", diff: [{ op: "add", text: curr.contentText.slice(0, 2000) }], summary: "Source is available again" };
  if (prev.contentHash === curr.contentHash) return { type: "UNCHANGED", diff: [], summary: "No change" };
  const diff = computeDiff(prev.contentText, curr.contentText);
  const added = diff.filter((d) => d.op === "add").map((d) => d.text.trim()).filter(Boolean);
  const removed = diff.filter((d) => d.op === "remove").map((d) => d.text.trim()).filter(Boolean);
  const summary =
    added.length || removed.length
      ? `${removed.length ? `"${removed.join(" ").slice(0, 80)}" → ` : ""}${added.length ? `"${added.join(" ").slice(0, 80)}"` : "(removed)"}`
      : "Content changed (whitespace/formatting)";
  return { type: "CHANGED", diff, summary };
}

/** Consecutive-failure policy: hard 404/410 → gone immediately; soft errors after N failures. */
export function availabilityFromFetch(status: number | null, consecutiveFailures: number, threshold = 3): "available" | "gone" | "transient_error" {
  if (status !== null && status >= 200 && status < 400) return "available";
  if (status === 404 || status === 410) return "gone";
  return consecutiveFailures + 1 >= threshold ? "gone" : "transient_error";
}
