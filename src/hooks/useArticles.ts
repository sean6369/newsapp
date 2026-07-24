"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "@heroui/react";
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

function filtersFromParams(params: URLSearchParams): ArticleFilters {
  return {
    feed: (params.get("feed") as ArticleFilters["feed"]) || "all",
    date: params.get("date") || undefined,
    search: params.get("search") || undefined,
    sort: (params.get("sort") as ArticleFilters["sort"]) || "relevance",
  };
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

function filtersToParams(filters: ArticleFilters, omitDefaults = true): string {
  const params = new URLSearchParams();
  if (filters.feed && filters.feed !== "all") params.set("feed", filters.feed);
  if (filters.date) params.set("date", filters.date);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort && (!omitDefaults || filters.sort !== "relevance")) params.set("sort", filters.sort);
  return params.toString();
}

function buildSwrKey(filters: ArticleFilters): string {
  return `/api/articles?${filtersToParams(filters, false)}`;
}

// Module-level: survives remounts (like hasFetchedOnce in Feed).
// On back-navigation the URL is "/" (no date param) but we know the
// latest date from the previous mount, so we seed filters immediately
// and the SWR key matches the cached entry — single-phase render.
// A full page reload re-evaluates the module, resetting to undefined.
let lastKnownLatestDate: string | undefined;

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
  const [filters, setFiltersState] = useState<ArticleFilters>(() => {
    const f = filtersFromParams(searchParams);
    if (!f.date && lastKnownLatestDate) {
      f.date = lastKnownLatestDate;
    }
    return f;
  });
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const initializedRef = useRef(!!searchParams.get("date") || !!lastKnownLatestDate);
  const filtersRef = useRef(filters);
  filtersRef.current = filters; // eslint-disable-line react-hooks/refs -- keep ref in sync with latest state for use in callbacks
  const latestDateRef = useRef<string | undefined>(undefined);

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

  // On first load with no date param, default to the most recent date
  useEffect(() => {
    if (data?.dates?.length) {
      latestDateRef.current = data.dates[0];
      lastKnownLatestDate = data.dates[0];
    }
    if (!initializedRef.current && !filtersRef.current.date && data?.dates?.length) {
      initializedRef.current = true;
      const latestDate = data.dates[0];
      setFiltersState((prev) => ({ ...prev, date: latestDate }));
    }
  }, [data]);

  const setFilters = useCallback(
    (partial: Partial<ArticleFilters>) => {
      setFiltersState((prev) => {
        const next = { ...prev, ...partial };

        queueMicrotask(() => {
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
      .then(() => {
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
        toast.success("Article deleted");
      })
      .catch((err) => {
        console.error("[delete]", err);
        toast.danger("Failed to delete article");
        throw err;
      });
  }, [mutate]);

  const refetch = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    articles: data?.articles ?? [],
    dates: data?.dates ?? [],
    loading: !data,
    fetching: isLoading && !!data,
    error: swrError ? (swrError instanceof Error ? swrError.message : "Unknown error") : null,
    filters,
    setFilters,
    refetch,
    lastFetchTime: data?.lastFetchTime ?? null,
    rescoringArticles,
    rescoreArticle,
    lastRescoredSlug,
    deleteArticle,
  };
}
