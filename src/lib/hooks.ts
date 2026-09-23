"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./utils";

/** Fetch JSON with optional polling. Pass `poll=false` to stop polling. */
export function useApi<T>(url: string | null, poll: number | false = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    apiFetch<T>(url)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  useEffect(() => {
    if (!poll || !url) return;
    const t = setInterval(() => setTick((x) => x + 1), poll);
    return () => clearInterval(t);
  }, [poll, url]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading: Boolean(url) && data === null && error === null, reload, setData };
}
