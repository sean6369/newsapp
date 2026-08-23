import type { ArticleFilters } from "@/lib/types";

/** Filter <-> query-string translation, shared by the server component that
 *  renders the first feed payload and the client hook that asks for every one
 *  after it. Both sides must agree character for character: the server seeds
 *  SWR's cache under the keys the client will look up, so a divergence here
 *  silently costs a round trip rather than failing loudly. Keep this module
 *  free of "use client" and of any client-only import — a server component
 *  cannot call into a client module. */

/**
 * A day the rest of the feed can safely handle, or nothing.
 *
 * The date navigator hands `date` to `parseDate`, which throws on anything
 * that is not a real ISO day — and it does it during render, so a hand-edited
 * or stale URL takes the whole feed down rather than merely showing an empty
 * one. Dropping the value here means such a URL falls back to the newest day,
 * and keeps the junk out of the SWR key both sides derive from these filters.
 */
function parseDateParam(raw: string | null): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00Z`);
  // The round trip rejects days that match the shape but do not exist, such as
  // 2026-02-30, which Date would otherwise roll forward into March.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return undefined;
  }
  return raw;
}

export function filtersFromParams(params: URLSearchParams): ArticleFilters {
  return {
    feed: (params.get("feed") as ArticleFilters["feed"]) || "all",
    date: parseDateParam(params.get("date")),
    search: params.get("search") || undefined,
    sort: (params.get("sort") as ArticleFilters["sort"]) || "relevance",
  };
}

export function filtersToParams(filters: ArticleFilters, omitDefaults = true): string {
  const params = new URLSearchParams();
  if (filters.feed && filters.feed !== "all") params.set("feed", filters.feed);
  if (filters.date) params.set("date", filters.date);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort && (!omitDefaults || filters.sort !== "relevance")) params.set("sort", filters.sort);
  return params.toString();
}

export function buildSwrKey(filters: ArticleFilters): string {
  return `/api/articles?${filtersToParams(filters, false)}`;
}
