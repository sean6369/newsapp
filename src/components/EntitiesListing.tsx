"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { SearchField, Select, ListBox, ListBoxItem } from "@heroui/react";
import type { EntityType, EntityListItem, EntitySortMode } from "@/lib/types";

const typeColor: Record<string, string> = {
  person: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  organization:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  location:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  product:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const typeFilterOptions: Array<{ value: EntityType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "person", label: "People" },
  { value: "organization", label: "Organizations" },
  { value: "location", label: "Locations" },
  { value: "product", label: "Products" },
];

const sortOptions = [
  { value: "trending", label: "Trending" },
  { value: "mentions", label: "Most mentioned" },
  { value: "recent", label: "Most recent" },
  { value: "alphabetical", label: "A-Z" },
] as const;

interface TrendingInfo {
  rank: number;
  previousRank: number | null;
}

interface EntitiesListingProps {
  entities: EntityListItem[];
  total: number;
  trending: Map<number, TrendingInfo>;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const target = new Date(dateStr);
  const diffMs = now.getTime() - target.getTime();

  if (diffMs < 0) return "just now";

  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;

  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EntitiesListing({
  entities: initialEntities,
  total: initialTotal,
  trending,
}: EntitiesListingProps) {
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<EntitySortMode>("trending");
  const [entities, setEntities] = useState<EntityListItem[]>(initialEntities);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const isDefault = typeFilter === "all" && sort === "trending" && !search.trim();

  // Server-side fetch on any filter/sort/search change
  useEffect(() => {
    if (isDefault) {
      setEntities(initialEntities);
      setTotal(initialTotal);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const params = new URLSearchParams({ sort, limit: "200" });
        if (typeFilter !== "all") params.set("type", typeFilter);
        const query = search.trim();
        if (query) params.set("search", query);
        const res = await fetch(`/api/entities?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Fetch failed");
        const data = await res.json();
        setEntities(data.entities);
        setTotal(data.total);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }, search.trim() ? 300 : 0);

    return () => clearTimeout(timer);
  }, [search, typeFilter, sort, isDefault, initialEntities, initialTotal]);

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-medium mb-1">Entities</h1>
          <p className="text-sm text-muted">
            {initialTotal} entities tracked across all articles
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {/* Type filter chips */}
          {typeFilterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTypeFilter(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                typeFilter === opt.value
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-muted hover:border-accent/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search + Sort */}
          <SearchField
            aria-label="Search entities"
            className="w-full md:w-auto order-last md:order-none"
            value={search}
            onChange={(value) => setSearch(value)}
            onClear={() => setSearch("")}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                className="w-full md:w-48"
                placeholder="Search entities..."
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <Select
            aria-label="Sort entities"
            selectedKey={sort}
            onSelectionChange={(key) => setSort(key as EntitySortMode)}
          >
            <Select.Trigger className="min-w-[100px] md:min-w-[140px]">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {sortOptions.map((opt) => (
                  <ListBoxItem
                    key={opt.value}
                    id={opt.value}
                    textValue={opt.label}
                  >
                    {opt.label}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        {/* Entity list */}
        {loading ? (
          <p className="text-muted text-sm py-16 text-center">
            Loading...
          </p>
        ) : entities.length === 0 ? (
          <p className="text-muted text-sm py-16 text-center">
            No entities found.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {entities.map((entity, i) => {
              const showTrending = sort === "trending" && typeFilter === "all" && !search.trim();
              const trend = showTrending ? trending.get(entity.id) : undefined;
              let movement: "up" | "down" | "new" | "same" | null = null;
              let rankDelta = 0;

              if (showTrending && trend) {
                if (trend.previousRank == null) {
                  movement = "new";
                } else if (trend.previousRank > trend.rank) {
                  movement = "up";
                  rankDelta = trend.previousRank - trend.rank;
                } else if (trend.previousRank < trend.rank) {
                  movement = "down";
                  rankDelta = trend.rank - trend.previousRank;
                } else {
                  movement = "same";
                }
              }

              return (
                <Link
                  key={entity.id}
                  href={`/entity/${entity.id}`}
                  className="group flex items-center gap-4 px-5 py-4 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors"
                >
                  {/* Rank number */}
                  <span className="text-sm text-muted font-mono w-6 text-right shrink-0">
                    {i + 1}
                  </span>

                  {/* Movement arrow (only in trending + all view) */}
                  {showTrending && (
                    <span className="w-8 shrink-0 text-center">
                      {movement === "new" && (
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          NEW
                        </span>
                      )}
                      {movement === "up" && rankDelta > 0 && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          ↑{rankDelta}
                        </span>
                      )}
                      {movement === "down" && rankDelta > 0 && (
                        <span className="text-xs text-red-500 dark:text-red-400">
                          ↓{rankDelta}
                        </span>
                      )}
                      {movement === "same" && (
                        <span className="text-xs text-muted">–</span>
                      )}
                    </span>
                  )}

                  {/* Name + last seen */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground group-hover:text-accent transition-colors truncate">
                      {entity.name}
                    </h3>
                    {entity.lastSeenAt && (
                      <p className="text-xs text-muted mt-0.5">
                        Last seen {formatRelativeTime(entity.lastSeenAt)}
                      </p>
                    )}
                  </div>

                  {/* Type badge */}
                  <span
                    className={`px-2.5 py-1 text-xs rounded-full font-medium capitalize shrink-0 ${
                      typeColor[entity.type] || "bg-muted/20 text-muted"
                    }`}
                  >
                    {entity.type}
                  </span>

                  {/* Mention count */}
                  <div className="text-right shrink-0 w-24">
                    <span className="text-sm font-mono text-foreground">
                      {sort === "trending" ? entity.trendingMentionCount : entity.mentionCount}
                    </span>
                    <span className="text-xs text-muted ml-1">
                      mention{(sort === "trending" ? entity.trendingMentionCount : entity.mentionCount) !== 1 ? "s" : ""}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {entities.length > 0 && (
          <p className="text-xs text-muted text-center mt-6">
            Showing {entities.length} of {total} entities
          </p>
        )}
      </div>
    </div>
  );
}
