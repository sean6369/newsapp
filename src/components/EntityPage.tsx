"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@heroui/react/button";
import { Popover } from "@heroui/react/popover";
import { RangeCalendar } from "@heroui/react/range-calendar";
import { ToggleButtonGroup, ToggleButton } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import type { DateValue } from "@internationalized/date";
import type { ArticleWithRelated, ArticleFilters, Entity } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";
import { ArticleRow } from "./ArticleRow";
import { FeedSort } from "./FeedFilter";
import { groupByStory } from "@/lib/group-stories";
import type { ViewMode } from "./ArticleGrid";
type SortMode = ArticleFilters["sort"];

const typeColor: Record<string, string> = {
  person: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  organization: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  location: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  product: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

interface CoOccurringEntity {
  entityId: number;
  name: string;
  type: string;
  sharedCount: number;
}

interface EntityPageProps {
  entity: Entity;
  articles: ArticleWithRelated[];
  coOccurring: CoOccurringEntity[];
}

interface DateRange {
  start: string;
  end: string;
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${day} ${month}`;
}

function formatDateLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = toDateStr(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  if (date.getFullYear() === today.getFullYear()) return `${day} ${month}`;
  return `${day} ${month} ${date.getFullYear()}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sortArticles(articles: ArticleWithRelated[], sort: SortMode): ArticleWithRelated[] {
  const sorted = [...articles];
  switch (sort) {
    case "date-asc":
      sorted.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
      break;
    case "relevance":
      sorted.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
      break;
    case "date-desc":
    default:
      sorted.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      break;
  }
  return sorted;
}

export function EntityPage({ entity, articles, coOccurring }: EntityPageProps) {
  const [range, setRange] = useState<DateRange | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>("date-desc");
  const [view, setView] = useState<ViewMode>("list");

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) set.add(a.date);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [articles]);

  const datesSet = useMemo(() => new Set(dates), [dates]);

  const filtered = useMemo(() => {
    let result: ArticleWithRelated[];
    if (!range) {
      result = articles;
    } else {
      const byDate = articles.flatMap((a) => {
        const matches = [a, ...(a.relatedArticles ?? [])].filter(
          (r) => r.date >= range.start && r.date <= range.end
        );
        return matches;
      });
      result = groupByStory(byDate);
    }
    return sortArticles(result, sort);
  }, [articles, range, sort]);

  const calendarValue = range
    ? { start: parseDate(range.start), end: parseDate(range.end) }
    : null;

  function handleRangeChange(value: { start: DateValue; end: DateValue } | null) {
    if (value) {
      setRange({ start: value.start.toString(), end: value.end.toString() });
    }
  }

  const rangeLabel = range
    ? range.start === range.end
      ? formatShortDate(range.start)
      : `${formatShortDate(range.start)} – ${formatShortDate(range.end)}`
    : null;

  const isDateSorted = sort === "date-desc" || sort === "date-asc";

  const dateGroups = useMemo(() => {
    if (!isDateSorted) return [];
    const groups: { date: string; articles: ArticleWithRelated[] }[] = [];
    for (const article of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.date === article.date) {
        last.articles.push(article);
      } else {
        groups.push({ date: article.date, articles: [article] });
      }
    }
    return groups;
  }, [filtered, isDateSorted]);

  // Adapter for FeedSort which expects ArticleFilters
  const filtersForSort: ArticleFilters = { sort };
  const handleSortChange = (partial: Partial<ArticleFilters>) => {
    if (partial.sort) setSort(partial.sort);
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
        {/* Back button */}
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center text-muted hover:text-foreground transition-colors mb-6"
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm">Back</span>
        </button>

        {/* Entity header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-serif text-3xl font-medium">{entity.name}</h1>
            <span className={`px-2.5 py-1 text-xs rounded-full font-medium capitalize ${typeColor[entity.type] || "bg-muted/20 text-muted"}`}>
              {entity.type}
            </span>
          </div>
          <p className="text-sm text-muted">
            {filtered.length} article{filtered.length !== 1 ? "s" : ""}
            {range ? "" : " total"}
          </p>
        </div>

        {/* Toolbar: date filter, sort, view toggle */}
        <div className="flex items-center justify-between mb-6">
          {/* Date filter */}
          <div className="flex items-center gap-2">
            {dates.length > 1 && (
              <Popover.Root isOpen={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <Popover.Trigger>
                  <button
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                      range
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {rangeLabel ?? "All time"}
                  </button>
                </Popover.Trigger>
                <Popover.Content>
                  <Popover.Dialog>
                    <RangeCalendar
                      value={calendarValue}
                      onChange={handleRangeChange}
                      isDateUnavailable={(date) => !datesSet.has(date.toString())}
                    >
                      <RangeCalendar.Header className="flex w-full items-center justify-between">
                        <RangeCalendar.Heading />
                        <div className="flex items-center gap-1">
                          <RangeCalendar.NavButton slot="previous" />
                          <RangeCalendar.NavButton slot="next" />
                        </div>
                      </RangeCalendar.Header>
                      <RangeCalendar.Grid>
                        <RangeCalendar.GridHeader>
                          {(day) => (
                            <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>
                          )}
                        </RangeCalendar.GridHeader>
                        <RangeCalendar.GridBody>
                          {(date) => <RangeCalendar.Cell date={date} />}
                        </RangeCalendar.GridBody>
                      </RangeCalendar.Grid>
                    </RangeCalendar>
                    <div className="flex items-center gap-2 border-t border-default pt-2 mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        onPress={() => {
                          const today = new Date();
                          const weekAgo = new Date();
                          weekAgo.setDate(today.getDate() - 7);
                          setRange({ start: toDateStr(weekAgo), end: toDateStr(today) });
                          setIsCalendarOpen(false);
                        }}
                      >
                        Last week
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        onPress={() => {
                          const today = new Date();
                          const monthAgo = new Date();
                          monthAgo.setMonth(today.getMonth() - 1);
                          setRange({ start: toDateStr(monthAgo), end: toDateStr(today) });
                          setIsCalendarOpen(false);
                        }}
                      >
                        Last month
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        isDisabled={!range}
                        onPress={() => {
                          setRange(null);
                          setIsCalendarOpen(false);
                        }}
                      >
                        All time
                      </Button>
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover.Root>
            )}
          </div>

          {/* Sort + View toggle */}
          <div className="flex items-center gap-3">
            <FeedSort
              filters={filtersForSort}
              onFilterChange={handleSortChange}
            />
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={new Set([view])}
              onSelectionChange={(keys) => {
                const selected = [...keys][0] as ViewMode | undefined;
                if (selected) setView(selected);
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

        {/* Co-occurring entities */}
        {coOccurring.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
              Also mentioned with
            </h2>
            <div className="flex flex-wrap gap-2">
              {coOccurring.map((e) => (
                <Link
                  key={e.entityId}
                  href={`/entity/${e.entityId}`}
                  className="px-3 py-1.5 text-sm rounded-full border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors"
                >
                  {e.name}
                  <span className="ml-1.5 text-xs text-muted">{e.sharedCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Articles */}
        {isDateSorted ? (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[7px] top-2 bottom-0 w-px bg-border" />

            {dateGroups.map((group, i) => (
              <div key={group.date} className={i > 0 ? "mt-8" : ""}>
                {/* Date label with dot */}
                <div className="relative flex items-center gap-3 mb-4">
                  <div className="w-[15px] flex-shrink-0 flex justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent relative z-10" />
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {formatDateLabel(group.date)}
                  </span>
                  <span className="text-xs text-muted">
                    {group.articles.length} article{group.articles.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Articles indented past timeline */}
                <div className="pl-8">
                  {view === "list" ? (
                    <div className="flex flex-col gap-2">
                      {group.articles.map((article) => (
                        <ArticleRow key={article.slug} article={article} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {group.articles.map((article) => (
                        <ArticleCard key={article.slug} article={article} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Flat layout for relevance sort */
          view === "list" ? (
            <div className="flex flex-col gap-2">
              {filtered.map((article) => (
                <ArticleRow key={article.slug} article={article} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
