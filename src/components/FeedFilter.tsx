"use client";

import type { ReactNode } from "react";
import { Tabs, SearchField, Select, ListBox, ListBoxItem, Dropdown, Drawer, ToggleButtonGroup, ToggleButton, useOverlayState } from "@heroui/react";
import { NEWS_FEEDS } from "@/lib/feed-sources";
import { LIBRARY_FEED, type ArticleFilters, type FeedType } from "@/lib/types";
import type { ViewMode } from "./ArticleGrid";

type FeedValue = FeedType | "all";

export interface FeedOption {
  value: FeedValue;
  label: string;
}

interface FeedFilterProps {
  feed: FeedValue | undefined;
  onFeedChange: (feed: FeedValue) => void;
  /** Defaults to the news feeds; search passes {@link SEARCH_FEED_OPTIONS}. */
  options?: readonly FeedOption[];
}

/**
 * The news feeds, in the order the tabs read, behind an "All" that no feed
 * corresponds to.
 *
 * The feeds themselves come from `NEWS_FEEDS`, which the settings page also
 * groups its sources under — one list, so a feed can never be named one thing
 * here and another there.
 */
export const FEED_OPTIONS: readonly FeedOption[] = [
  { value: "all", label: "All" },
  ...NEWS_FEEDS,
];

/**
 * Search's tabs: the news feeds, plus the library as a scope of its own.
 *
 * Only search offers it. The home feed is the day's news and clips are
 * deliberately no part of that, so a Library tab there would be a filter that
 * can only ever come back empty. Picking it here does not narrow the news —
 * it searches the clips *instead of* it (see `searchArticles`).
 */
export const SEARCH_FEED_OPTIONS: readonly FeedOption[] = [
  ...FEED_OPTIONS,
  { value: LIBRARY_FEED, label: "Library" },
];

export function FeedFilter({ feed, onFeedChange, options = FEED_OPTIONS }: FeedFilterProps) {
  const currentFeed = feed || "all";
  const currentLabel = options.find((o) => o.value === currentFeed)?.label ?? "All";

  return (
    <>
      {/* Desktop: Tabs */}
      <div className="hidden md:block min-w-0">
        <Tabs
          variant="secondary"
          selectedKey={currentFeed}
          onSelectionChange={(key) => onFeedChange(key as FeedValue)}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Feed filter">
              {options.map((opt) => (
                <Tabs.Tab key={opt.value} id={opt.value} className="min-w-20 px-0">
                  {opt.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {/* Mobile: Dropdown. Fixed width so it does not resize as the feed
          changes, matching the desktop tabs' own min-width. Sized to
          "Singapore", the longest label. */}
      <div className="md:hidden">
        <Dropdown>
          <Dropdown.Trigger className="min-w-28 text-center px-3 py-1.5 text-sm font-medium border-2 border-border rounded-lg bg-background hover:border-accent/40 transition-colors">
            {currentLabel}
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="Feed filter"
              selectionMode="single"
              selectedKeys={new Set([currentFeed])}
              onSelectionChange={(keys) => {
                const selected = [...keys][0] as FeedValue | undefined;
                if (selected) onFeedChange(selected);
              }}
            >
              {options.map((opt) => (
                <Dropdown.Item key={opt.value} id={opt.value}>
                  {opt.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </>
  );
}

const sortOptions = [
  { value: "relevance", label: "Relevance" },
  { value: "date-desc", label: "Latest" },
  { value: "date-asc", label: "Oldest" },
] as const;

interface FeedSortProps {
  filters: ArticleFilters;
  onFilterChange: (filters: Partial<ArticleFilters>) => void;
}

export function FeedSort({ filters, onFilterChange }: FeedSortProps) {
  return (
    <Select
      aria-label="Sort articles"
      selectedKey={filters.sort || "date-desc"}
      onSelectionChange={(key) => {
        onFilterChange({ sort: key as ArticleFilters["sort"] });
      }}
    >
      <Select.Trigger className="min-w-[100px] md:min-w-[120px]">
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
  );
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * The toolbar search box, shared by every page that has one.
 *
 * Split out from {@link FeedSearch} so the library can use it: that page has
 * no `ArticleFilters` to thread through, just a string, and a second copy of
 * this markup would be one more place for the two to drift apart.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  "aria-label": ariaLabel = "Search articles",
}: SearchInputProps) {
  return (
    <SearchField
      aria-label={ariaLabel}
      className="flex-1 min-w-0 md:flex-none"
      value={value}
      onChange={onChange}
      onClear={() => onChange("")}
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input className="w-full md:w-48" placeholder={placeholder} />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}

interface FeedSearchProps {
  filters: ArticleFilters;
  onFilterChange: (filters: Partial<ArticleFilters>) => void;
}

export function FeedSearch({ filters, onFilterChange }: FeedSearchProps) {
  return (
    <SearchInput
      value={filters.search || ""}
      onChange={(value) => onFilterChange({ search: value || undefined })}
    />
  );
}

/**
 * Grid/list switch. Lives here rather than inline in each toolbar so the two
 * icons are drawn once — they were already duplicated between the feed's
 * toolbar and the mobile settings drawer.
 */
export function ViewToggle({
  view,
  onViewChange,
  onSelected,
}: {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** Fired after a change, so the mobile drawer can close itself. */
  onSelected?: () => void;
}) {
  return (
    <ToggleButtonGroup
      selectionMode="single"
      selectedKeys={new Set([view])}
      onSelectionChange={(keys) => {
        const selected = [...keys][0] as ViewMode | undefined;
        if (!selected) return;
        onViewChange(selected);
        onSelected?.();
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
  );
}

type SortValue = NonNullable<ArticleFilters["sort"]>;

interface MobileSettingsProps {
  sort: SortValue | undefined;
  onSortChange: (sort: SortValue) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** Labels differ per page — search calls "relevance" Best match, the feed calls it Relevance. */
  sortLabels?: readonly { value: SortValue; label: string }[];
  /** Extra sections rendered above Sort, e.g. the search page's date range. */
  children?: (close: () => void) => ReactNode;
}

export function MobileSettings({
  sort,
  onSortChange,
  view,
  onViewChange,
  sortLabels = sortOptions,
  children,
}: MobileSettingsProps) {
  const currentSort = sort || "date-desc";
  const drawerState = useOverlayState();

  return (
    <div className="md:hidden">
      <Drawer state={drawerState}>
        <Drawer.Trigger
          className="flex items-center justify-center w-9 h-9 border-2 border-border rounded-lg bg-background hover:border-accent/40 transition-colors"
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="4" x2="15" y2="4" />
            <line x1="3" y1="9" x2="15" y2="9" />
            <line x1="3" y1="14" x2="15" y2="14" />
            <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="8" cy="14" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </Drawer.Trigger>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog>
              <Drawer.Header>
                <Drawer.Handle />
                <Drawer.Heading>Settings</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                <div className="flex flex-col gap-6">
                  {children?.(drawerState.close)}

                  {/* Sort */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted mb-3">Sort by</h3>
                    <div className="flex flex-col gap-1">
                      {sortLabels.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            onSortChange(opt.value);
                            drawerState.close();
                          }}
                          className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            currentSort === opt.value
                              ? "bg-accent/10 text-accent font-medium"
                              : "text-foreground hover:bg-border/50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* View */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted mb-3">View</h3>
                    <ViewToggle
                      view={view}
                      onViewChange={onViewChange}
                      onSelected={drawerState.close}
                    />
                  </div>
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
