"use client";

import { useState, useEffect, useRef } from "react";
import { ToggleButtonGroup, ToggleButton } from "@heroui/react";
import { useArticles } from "@/hooks/useArticles";
import { FeedFilter, FeedSearch, FeedSort, MobileSettings } from "@/components/FeedFilter";
import { DateNav } from "@/components/DateNav";
import { ArticleGrid, type ViewMode } from "@/components/ArticleGrid";

const VIEW_COOKIE = "feed-view";

// Module-level flag: only run /api/fetch on the first mount per page load.
// Back-navigation remounts the component but this stays true, skipping the fetch.
// A full page reload re-evaluates the module, resetting it to false.
let hasFetchedOnce = false;

function setViewCookie(value: string) {
  document.cookie = `${VIEW_COOKIE}=${value};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

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
    setViewCookie(selected);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
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
          filters={filters}
          onFilterChange={setFilters}
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
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={new Set([view])}
            onSelectionChange={(keys) => {
              const selected = [...keys][0] as ViewMode | undefined;
              if (selected) handleViewChange(selected);
            }}
          >
            <ToggleButton id="grid" aria-label="Grid view">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
                <rect x="9.5" y="1" width="5.5" height="5.5" rx="1" />
                <rect x="1" y="9.5" width="5.5" height="5.5" rx="1" />
                <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" />
              </svg>
            </ToggleButton>
            <ToggleButton id="list" aria-label="List view">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="1" y1="3" x2="15" y2="3" />
                <line x1="1" y1="8" x2="15" y2="8" />
                <line x1="1" y1="13" x2="15" y2="13" />
              </svg>
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
      </div>

      {/* Mobile toolbar */}
      <div className="flex md:hidden items-center gap-2 mb-6">
        <FeedFilter
          filters={filters}
          onFilterChange={setFilters}
        />
        <FeedSearch
          filters={filters}
          onFilterChange={setFilters}
        />
        <MobileSettings
          filters={filters}
          onFilterChange={setFilters}
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
