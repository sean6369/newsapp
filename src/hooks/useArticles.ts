"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "@heroui/react";
import { filtersFromParams, filtersToParams, buildSwrKey } from "@/lib/feed-query";
import type { ArticleWithRelated, ArticleFilters } from "@/lib/types";

interface ArticlesData {
  articles: ArticleWithRelated[];
  dates: string[];
  lastFetchTime: string | null;
}

interface UseArticlesReturn {
  articles: ArticleWithRelated[];
  dates: string[];
  loading: boolean;
  fetching: boolean;
  error: string | null;
  filters: ArticleFilters;
  setFilters: (filters: Partial<ArticleFilters>) => void;
  refetch: () => void;
  lastFetchTime: string | null;
  rescoringArticles: Set<string>;
  rescoreArticle: (slug: string) => void;
  lastRescoredSlug: string | null;
  deleteArticle: (slug: string) => Promise<void>;
}

function sortArticles(list: ArticleWithRelated[], sort?: string): ArticleWithRelated[] {
  return [...list].sort((a, b) => {
    if (sort === "relevance") {
      const sa = a.relevanceScore ?? -1;
      const sb = b.relevanceScore ?? -1;
      if (sb !== sa) return sb - sa;
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (sort === "date-asc") return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

const fetcher = async (url: string): Promise<ArticlesData> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch articles");
  const data = await response.json();
  return {
    articles: data.articles,
    dates: data.dates || [],
    lastFetchTime: data.lastFetchTime ?? null,
  };
};

export function useArticles(): UseArticlesReturn {
  const searchParams = useSearchParams();
  // `date: undefined` is not "no opinion", it is the canonical spelling of
  // "the newest day" — the same thing /api/articles resolves a dateless
  // request to. Keeping it that way through the whole session is what lets a
  // cold load settle on one SWR key and stay there: the page seeds that key
  // from the server, the hook mounts on it, and nothing re-keys behind it.
  const [filters, setFiltersState] = useState<ArticleFilters>(() => filtersFromParams(searchParams));
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const filtersRef = useRef(filters);
  filtersRef.current = filters; // eslint-disable-line react-hooks/refs -- keep ref in sync with latest state for use in callbacks
  const latestDateRef = useRef<string | undefined>(undefined);
  const { cache, fallback: seededPayloads } = useSWRConfig();

  // Debounce search value for SWR key
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // SWR key uses debounced search to avoid fetching on every keystroke
  const swrKey = buildSwrKey({ ...filters, search: debouncedSearch });

  const { data, error: swrError, isLoading, mutate } = useSWR<ArticlesData>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      keepPreviousData: true,
      // Poll while the current view has recently-added articles still awaiting a
      // relevance score (filled in by the pipeline's deferred scoring pass) so
      // they re-sort into place on their own, then return 0 to stop — an idle
      // feed makes no background requests. Intentionally a fresh function each
      // render (do NOT memoize): a new reference lets SWR's poll effect re-run
      // and (re)start the loop when unscored articles arrive after a fetch — a
      // stable ref would leave the loop dead. SWR also re-evaluates it every
      // tick, so the recency cutoff stops polling even for a row that never scores.
      refreshInterval: (latest: ArticlesData | undefined) => {
        const cutoff = Date.now() - 10 * 60 * 1000;
        const waiting = latest?.articles.some(
          (a) => a.relevanceScore == null && new Date(a.createdAt).getTime() > cutoff
        );
        return waiting ? 60_000 : 0;
      },
    }
  );

  // Only records which day "newest" currently resolves to. It deliberately
  // does not write that date into filters: doing so is what used to move the
  // SWR key off the one the server had just seeded, costing a second request
  // for bytes the page was already holding.
  useEffect(() => {
    if (data?.dates?.length) latestDateRef.current = data.dates[0];
  }, [data]);

  const setFilters = useCallback(
    (partial: Partial<ArticleFilters>) => {
      setFiltersState((prev) => {
        const next = { ...prev, ...partial };

        queueMicrotask(() => {
          // The newest day stays out of the URL, so a reload lands back on the
          // dateless key the page seeds. Only the address is trimmed — `next`
          // keeps the date, so naming the newest day explicitly still re-fetches
          // it, which is what you want for the one day still being written to.
          const urlFilters = { ...next };
          if (urlFilters.date === latestDateRef.current) {
            delete urlFilters.date;
          }
          const qs = filtersToParams(urlFilters);
          window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
        });

        return next;
      });
    },
    []
  );

  const [rescoringArticles, setRescoringArticles] = useState<Set<string>>(new Set());
  const [lastRescoredSlug, setLastRescoredSlug] = useState<string | null>(null);

  const rescoreArticle = useCallback((slug: string) => {
    setRescoringArticles((prev) => new Set(prev).add(slug));
    setLastRescoredSlug(null);

    fetch("/api/rescore-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.statusText)))
      .then((resData) => {
        mutate(
          (current) => {
            if (!current) return current;
            const updated = current.articles.map((a) => {
              if (a.slug === slug) return { ...a, relevanceScore: resData.score };
              if (a.relatedArticles?.some((r) => r.slug === slug))
                return {
                  ...a,
                  relatedArticles: a.relatedArticles!.map((r) =>
                    r.slug === slug ? { ...r, relevanceScore: resData.score } : r
                  ),
                };
              return a;
            });
            return { ...current, articles: sortArticles(updated, filtersRef.current.sort) };
          },
          { revalidate: false }
        );
        setLastRescoredSlug(slug);
      })
      .catch((err) => console.error("[rescore]", err))
      .finally(() => {
        setRescoringArticles((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      });
  }, [mutate]);

  const deleteArticle = useCallback((slug: string) => {
    return fetch("/api/delete-article", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.statusText)))
      .then((body: { wasInLibrary?: boolean }) => {
        let promotedSlug: string | null = null;
        mutate(
          (current) => {
            if (!current) return current;
            // Check if this slug exists as a nested related article.
            // If so, only remove it from relatedArticles — don't also
            // delete/promote the top-level entry that shares this slug.
            const isNested = current.articles.some(
              (a) => a.relatedArticles?.some((r) => r.slug === slug)
            );
            const updated = current.articles.flatMap((a) => {
                if (!isNested && a.slug === slug) {
                  // Deleting the primary – promote first related article
                  if (a.relatedArticles?.length) {
                    const [newPrimary, ...rest] = a.relatedArticles;
                    promotedSlug = newPrimary.slug;
                    return [{ ...newPrimary, relatedArticles: rest.length > 0 ? rest : undefined } as ArticleWithRelated];
                  }
                  return []; // standalone article, just remove
                }
                // Remove from relatedArticles if nested
                if (a.relatedArticles?.some((r) => r.slug === slug)) {
                  const filtered = a.relatedArticles!.filter((r) => r.slug !== slug);
                  return [{ ...a, relatedArticles: filtered.length > 0 ? filtered : undefined }];
                }
                return [a];
              });
            return {
              ...current,
              articles: sortArticles(updated, filtersRef.current.sort),
            };
          },
          { revalidate: false }
        );
        if (promotedSlug) setLastRescoredSlug(promotedSlug);
        // Deleting here removes the row outright, so a saved article is gone
        // from the library too. Say which happened rather than letting the
        // reader discover it later.
        if (body.wasInLibrary) {
          toast.warning("Article deleted — also removed from your library");
        } else {
          toast.success("Article deleted");
        }
      })
      .catch((err) => {
        console.error("[delete]", err);
        toast.danger("Failed to delete article");
        throw err;
      });
  }, [mutate]);

  // The server hands this page its first screen through SWR's `fallback` map,
  // which is consulted beside the cache rather than written into it. Two of
  // SWR's behaviours read the cache directly and so cannot see it:
  // `keepPreviousData` hands back the key you just left instead of the seeded
  // one, and nothing revalidates afterwards, because seeded data still counts
  // as data. Returning to the seeded key — toggling sort and back — would show
  // the wrong day's articles for good. Copying the seed into the cache once it
  // has been read makes it an ordinary entry and both behaviours line up again.
  useEffect(() => {
    const seeded = seededPayloads?.[swrKey];
    if (seeded && cache.get(swrKey)?.data === undefined) {
      // Only ever the seed for this exact key. Writing whatever `data` happens
      // to hold would copy the day being left into the day being opened, since
      // keepPreviousData means `data` still reads as the previous key's during
      // the render the key changes on.
      mutate(seeded, { revalidate: false });
    }
  }, [swrKey, seededPayloads, cache, mutate]);

  const refetch = useCallback(() => {
    mutate();
  }, [mutate]);

  // What the reader is shown they are looking at. The key leaves the newest
  // day unnamed on purpose; the date navigator has to print something, and
  // only the response knows which day "newest" came back as. Everything that
  // writes back does so with a partial, so this display value never becomes
  // the key.
  const displayFilters = useMemo(
    () => ({ ...filters, date: filters.date ?? data?.dates?.[0] }),
    [filters, data]
  );

  return {
    articles: data?.articles ?? [],
    dates: data?.dates ?? [],
    loading: !data,
    fetching: isLoading && !!data,
    error: swrError ? (swrError instanceof Error ? swrError.message : "Unknown error") : null,
    filters: displayFilters,
    setFilters,
    refetch,
    lastFetchTime: data?.lastFetchTime ?? null,
    rescoringArticles,
    rescoreArticle,
    lastRescoredSlug,
    deleteArticle,
  };
}
