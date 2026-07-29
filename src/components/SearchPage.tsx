"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  RangeCalendar,
  SearchField,
  Select,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { parseDate } from "@internationalized/date";
import type { DateValue } from "@internationalized/date";
import type {
  FeedType,
  SearchMode,
  SearchResultArticle,
  SearchSortMode,
} from "@/lib/types";
import { SEARCH_PAGE_SIZE, DEFAULT_SEARCH_SORT } from "@/lib/types";
import { ArticleTimeline, formatShortDate, toDateStr } from "./ArticleTimeline";
import { SearchSnippet, HighlightedText } from "./SearchSnippet";
import type { ViewMode } from "./ArticleGrid";

const feedOptions: Array<{ value: FeedType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "singapore", label: "Singapore" },
  { value: "world", label: "World" },
  { value: "asia", label: "Asia" },
  { value: "finance", label: "Finance" },
  { value: "ai", label: "AI" },
  { value: "tech", label: "Tech" },
];

const sortOptions: Array<{ value: SearchSortMode; label: string }> = [
  { value: "relevance", label: "Best match" },
  { value: "date-desc", label: "Newest" },
  { value: "date-asc", label: "Oldest" },
];

// Postgres `websearch_to_tsquery` syntax — see searchArticles() in db/queries.
// Straight quotes only: it does not recognise the typographic kind.
const searchTips: Array<{ example: string; meaning: string }> = [
  { example: "chip smuggling", meaning: "Both words, anywhere in the article" },
  { example: '"rate cut"', meaning: "The exact phrase, words side by side" },
  { example: "tariffs or sanctions", meaning: "Either word" },
  { example: "rates -crypto", meaning: "Everything about rates, minus crypto" },
  { example: '"data centre" -singapore', meaning: "Mix them freely" },
];

interface DateRange {
  start: string;
  end: string;
}

export interface SearchPageProps {
  initialQuery: string;
  initialResults: SearchResultArticle[];
  initialTotal: number;
  initialRowCount: number;
  initialMode: SearchMode;
  /** Every date that has articles, newest first. Bounds and greys out the calendar. */
  availableDates: string[];
}

export function SearchPage({
  initialQuery,
  initialResults,
  initialTotal,
  initialRowCount,
  initialMode,
  availableDates,
}: SearchPageProps) {
  const router = useRouter();

  const datesSet = useMemo(() => new Set(availableDates), [availableDates]);
  // availableDates arrives newest first.
  const dateBounds =
    availableDates.length > 0
      ? { min: availableDates[availableDates.length - 1], max: availableDates[0] }
      : null;

  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [feed, setFeed] = useState<FeedType | "all">("all");
  const [range, setRange] = useState<DateRange | null>(null);
  const [sort, setSort] = useState<SearchSortMode>(DEFAULT_SEARCH_SORT);
  const [view, setView] = useState<ViewMode>("list");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const [results, setResults] = useState(initialResults);
  const [total, setTotal] = useState(initialTotal);
  // Rows consumed so far, which is what the SQL OFFSET advances by. Differs
  // from results.length once story grouping collapses duplicates.
  const [rowsLoaded, setRowsLoaded] = useState(initialRowCount);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  // The sort the currently displayed results were actually fetched with. `sort`
  // changes the instant the dropdown does, a render before the new rows arrive,
  // so grouping must follow this instead — otherwise rank-ordered rows get laid
  // out under date headings and shatter into repeated groups.
  const [resultsSort, setResultsSort] = useState<SearchSortMode>(DEFAULT_SEARCH_SORT);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  // Skip the first fetch: the server already rendered results for this query.
  const hydratedRef = useRef(true);

  const buildParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ q: query, sort, limit: String(SEARCH_PAGE_SIZE) });
      if (feed !== "all") params.set("feed", feed);
      if (range) {
        params.set("from", range.start);
        params.set("to", range.end);
      }
      if (offset > 0) params.set("offset", String(offset));
      return params;
    },
    [query, sort, feed, range]
  );

  // Debounce typing into the committed query.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 300);
    return () => clearTimeout(timer);
  }, [input]);

  // Re-run the search whenever the query or any filter changes.
  useEffect(() => {
    if (hydratedRef.current) {
      hydratedRef.current = false;
      return;
    }

    const trimmed = query.trim();
    router.replace(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search", {
      scroll: false,
    });

    // Nothing to search for. The render gates on `hasQuery`, so the previous
    // results stay in state harmlessly until the next query replaces them.
    if (!trimmed) return;

    abortRef.current?.abort();
    // A page-2 request still in flight belongs to the previous result set. Let
    // it land and it would append rows in the old sort order onto the new ones
    // and inflate rowsLoaded, so cancel it alongside the search it came from.
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?${buildParams(0)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.results);
        setTotal(data.total);
        setRowsLoaded(data.rowCount);
        setMode(data.mode);
        setResultsSort(sort);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setTotal(0);
        setRowsLoaded(0);
        setMode("empty");
      } finally {
        // An aborted request has been superseded by a newer one that is still
        // in flight — clearing the flag here would drop the spinner and flash
        // the previous results until that one lands.
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [query, sort, buildParams, router]);

  async function loadMore() {
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    setLoadingMore(true);
    try {
      const res = await fetch(`/api/search?${buildParams(rowsLoaded)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults((prev) => {
        // Grouping runs per page, so a story straddling the page boundary can
        // come back again as its own result. Drop anything already shown.
        const seen = new Set(prev.map((a) => a.slug));
        return [
          ...prev,
          ...(data.results as SearchResultArticle[]).filter((a) => !seen.has(a.slug)),
        ];
      });
      setRowsLoaded((prev) => prev + data.rowCount);
    } catch {
      // Aborted, or the request failed. Either way nothing was applied — leave
      // what is on screen and keep the button available to retry.
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  function handleRangeChange(value: { start: DateValue; end: DateValue } | null) {
    if (!value) return;
    setRange({ start: value.start.toString(), end: value.end.toString() });
    // Only fires once both ends are picked, so the range is complete here.
    setIsCalendarOpen(false);
  }

  const calendarValue = range
    ? { start: parseDate(range.start), end: parseDate(range.end) }
    : null;

  const rangeLabel = range
    ? range.start === range.end
      ? formatShortDate(range.start)
      : `${formatShortDate(range.start)} – ${formatShortDate(range.end)}`
    : null;

  // Highlighted titles are keyed by slug so a grouped row swiped to another
  // source still gets that source's own highlighting.
  const titleHighlights = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) {
      if (r.titleHighlight) map.set(r.slug, r.titleHighlight);
      for (const rel of r.relatedArticles ?? []) {
        if (rel.titleHighlight) map.set(rel.slug, rel.titleHighlight);
      }
    }
    return map;
  }, [results]);

  // The box is what the reader is searching for; `query` lags it by the
  // debounce. Treating that gap as "searching" keeps the results area from
  // flashing an empty state during the 300ms before the request goes out.
  const hasQuery = input.trim().length > 0 || query.trim().length > 0;
  const searching = loading || input.trim() !== query.trim();
  // Rank order has no date structure, so only group into a timeline by date.
  const grouped = resultsSort !== "relevance";

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-serif text-3xl font-medium mb-1">Search</h1>
          <p className="text-sm text-muted">Every article, all dates.</p>
        </div>

        {/* Search box */}
        <SearchField
          aria-label="Search articles"
          className="w-full mb-4"
          value={input}
          onChange={setInput}
          onClear={() => setInput("")}
          autoFocus
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input className="w-full" placeholder="Search articles" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {feedOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFeed(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                feed === opt.value
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-muted hover:border-accent/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}

          <div className="flex-1" />

          {/* Date range */}
          {dateBounds && (
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
                    minValue={parseDate(dateBounds.min)}
                    maxValue={parseDate(dateBounds.max)}
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
                        {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
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

          <Select
            aria-label="Sort results"
            selectedKey={sort}
            onSelectionChange={(key) => setSort(key as SearchSortMode)}
          >
            <Select.Trigger className="min-w-[110px] md:min-w-[140px]">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {sortOptions.map((opt) => (
                  <ListBoxItem key={opt.value} id={opt.value} textValue={opt.label}>
                    {opt.label}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

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

        {/* Result meta. Kept (dimmed) while a new search is in flight, so the
            page doesn't reflow around the results it is about to replace. */}
        {hasQuery && (results.length > 0 || !searching) && (
          <div
            className="mb-4"
            style={{
              opacity: searching ? 0.5 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            <p className="text-sm text-muted">
              {total === 0
                ? "No matches"
                : `${total} article${total !== 1 ? "s" : ""} matching “${query.trim()}”`}
            </p>
            {mode === "fuzzy" && (
              <p className="text-xs text-muted mt-1">
                No exact matches — showing articles with similar titles.
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {!hasQuery ? (
          <div className="py-16">
            <p className="text-center text-sm text-muted">
              Every article in the archive — titles, summaries and full text.
            </p>

            <dl className="mx-auto mt-8 max-w-lg space-y-3">
              {searchTips.map((tip) => (
                <div
                  key={tip.example}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:flex-nowrap"
                >
                  <dt className="sm:w-[45%] sm:flex-shrink-0 sm:text-right">
                    <code className="font-mono text-xs rounded border border-border bg-card-bg px-1.5 py-0.5 text-foreground">
                      {tip.example}
                    </code>
                  </dt>
                  <dd className="text-xs text-muted">{tip.meaning}</dd>
                </div>
              ))}
            </dl>

            <p className="mx-auto mt-8 max-w-md text-center text-xs text-muted">
              Words match by stem, so <span className="font-mono">smuggling</span> also
              finds <span className="font-mono">smuggled</span>. Misspell something and
              the closest headlines come back instead.
            </p>
          </div>
        ) : !searching && results.length === 0 ? (
          <p className="text-muted text-sm py-16 text-center">
            Nothing found. Try fewer or different words.
          </p>
        ) : (
          <>
            <ArticleTimeline
              articles={results}
              view={view}
              grouped={grouped}
              fetching={searching}
              sort={resultsSort}
              renderExtra={(article) =>
                article.snippet ? <SearchSnippet snippet={article.snippet} /> : null
              }
              renderTitle={(article) => {
                const highlighted = titleHighlights.get(article.slug);
                return highlighted ? (
                  <HighlightedText text={highlighted} variant="title" />
                ) : (
                  article.title
                );
              }}
            />

            {!searching && rowsLoaded < total && (
              <div className="flex justify-center mt-8">
                <Button variant="ghost" onPress={loadMore} isDisabled={loadingMore}>
                  {loadingMore ? "Loading..." : `Load more (${total - rowsLoaded} left)`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
