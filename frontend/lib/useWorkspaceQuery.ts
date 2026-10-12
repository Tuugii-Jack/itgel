"use client";
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

export function updateWorkspaceQuery(values: Record<string, string | null>, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (target !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history[replace ? "replaceState" : "pushState"](null, "", target);
  }
}

/** Шүүлт, дэлгэрэнгүй, browser Back/Forward нь нэг URL төлөвтэй. */
export function useWorkspaceQuery(key: string, fallback = "", replace = false) {
  const search = useSearchParams();
  const value = search.get(key) ?? fallback;
  const setValue = useCallback((next: string | null) => {
    updateWorkspaceQuery({ [key]: next && next !== fallback ? next : null }, replace);
  }, [key, fallback, replace]);
  return [value, setValue] as const;
}
