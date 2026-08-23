"use client";

import { useState, useEffect, useRef } from "react";
import { useArticles } from "@/hooks/useArticles";
import { FeedFilter, FeedSearch, FeedSort, MobileSettings, ViewToggle } from "@/components/FeedFilter";
import { DateNav } from "@/components/DateNav";
import { ArticleGrid, type ViewMode } from "@/components/ArticleGrid";
import { FEED_VIEW_COOKIE, setViewCookie } from "@/lib/view-cookie";
import { Masthead } from "@/components/Masthead";

// Module-level flag: only run /api/fetch on the first mount per page load.
// Back-navigation remounts the component but this stays true, skipping the fetch.
// A full page reload re-evaluates the module, resetting it to false.
let hasFetchedOnce = false;

export function Feed({ initialView = "grid" }: { initialView?: ViewMode }) {
  const { articles, dates, loading, fetching, error, filters, setFilters, refetch, lastFetchTime, rescoringArticles, rescoreArticle, lastRescoredSlug, deleteArticle } = useArticles();
  const [view, setView] = useState<ViewMode>(initialView);
  const skipEntranceRef = useRef(hasFetchedOnce);

  // Trigger the fetch pipeline only on the first mount (fresh page load).
  // On back-navigation the SWR cache provides data instantly, so we skip
  // the /api/fetch call entirely for a truly silent back experience.
  useEffect(() => {
    if (hasFetchedOnce) return;
    hasFetchedOnce = true;

    fetch("/api/fetch", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        console.log("[auto-fetch]", data);
        if (data.newArticles > 0) {
          skipEntranceRef.current = true;
          refetch();
        }
      })
      .catch((err) => console.error("[auto-fetch] failed:", err));
  }, [refetch]);

  const handleViewChange = (selected: ViewMode) => {
    setView(selected);
    setViewCookie(FEED_VIEW_COOKIE, selected);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
      <Masthead />
      <div className="flex justify-center mb-4">
        <DateNav
          dates={dates}
          currentDate={filters.date}
          onDateChange={(date) => setFilters({ date })}
        />
      </div>
      {/* Desktop toolbar */}
      <div className="hidden md:flex items-center justify-between mb-6">
        <FeedFilter
          feed={filters.feed}
          onFeedChange={(feed) => setFilters({ feed })}
        />
        <div className="flex items-center gap-3">
          <FeedSearch
            filters={filters}
            onFilterChange={setFilters}
          />
          <FeedSort
            filters={filters}
            onFilterChange={setFilters}
          />
          <ViewToggle view={view} onViewChange={handleViewChange} />
        </div>
      </div>

      {/* Mobile toolbar */}
      <div className="flex md:hidden items-center gap-2 mb-6">
        <FeedFilter
          feed={filters.feed}
          onFeedChange={(feed) => setFilters({ feed })}
        />
        <FeedSearch
          filters={filters}
          onFilterChange={setFilters}
        />
        <MobileSettings
          sort={filters.sort}
          onSortChange={(sort) => setFilters({ sort })}
          view={view}
          onViewChange={handleViewChange}
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <ArticleGrid
        articles={articles}
        loading={loading}
        fetching={fetching}
        view={view}
        sort={filters.sort}
        rescoringArticles={rescoringArticles}
        onRescore={rescoreArticle}
        onDelete={deleteArticle}
        lastRescoredSlug={lastRescoredSlug}
        skipEntranceRef={skipEntranceRef}
      />

      {lastFetchTime && (
        <p className="text-right text-xs text-muted mt-6">
          Last fetched: {new Date(lastFetchTime).toLocaleString()}
        </p>
      )}
    </div>
  );
}
