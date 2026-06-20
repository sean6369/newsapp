"use client";

import { Tabs, SearchField, Select, ListBox, ListBoxItem, Dropdown, Drawer, ToggleButtonGroup, ToggleButton, useOverlayState } from "@heroui/react";
import type { ArticleFilters } from "@/lib/types";
import type { ViewMode } from "./ArticleGrid";

interface FeedFilterProps {
  filters: ArticleFilters;
  onFilterChange: (filters: Partial<ArticleFilters>) => void;
}

const feedOptions = [
  { value: "all", label: "All" },
  { value: "singapore", label: "Singapore" },
  { value: "world", label: "World" },
  { value: "asia", label: "Asia" },
  { value: "finance", label: "Finance" },
  { value: "ai", label: "AI" },
  { value: "tech", label: "Tech" },
] as const;

export function FeedFilter({ filters, onFilterChange }: FeedFilterProps) {
  const currentFeed = filters.feed || "all";
  const currentLabel = feedOptions.find((o) => o.value === currentFeed)?.label ?? "All";

  return (
    <>
      {/* Desktop: Tabs */}
      <div className="hidden md:block">
        <Tabs
          variant="secondary"
          selectedKey={currentFeed}
          onSelectionChange={(key) =>
            onFilterChange({ feed: key as ArticleFilters["feed"] })
          }
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Feed filter">
              {feedOptions.map((opt) => (
                <Tabs.Tab key={opt.value} id={opt.value}>
                  {opt.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {/* Mobile: Dropdown */}
      <div className="md:hidden">
        <Dropdown>
          <Dropdown.Trigger className="px-3 py-1.5 text-sm font-medium border-2 border-border rounded-lg bg-background hover:border-accent/40 transition-colors">
            {currentLabel}
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="Feed filter"
              selectionMode="single"
              selectedKeys={new Set([currentFeed])}
              onSelectionChange={(keys) => {
                const selected = [...keys][0] as ArticleFilters["feed"];
                if (selected) onFilterChange({ feed: selected });
              }}
            >
              {feedOptions.map((opt) => (
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

interface FeedSearchProps {
  filters: ArticleFilters;
  onFilterChange: (filters: Partial<ArticleFilters>) => void;
}

export function FeedSearch({ filters, onFilterChange }: FeedSearchProps) {
  return (
    <SearchField
      aria-label="Search articles"
      className="flex-1 min-w-0 md:flex-none"
      value={filters.search || ""}
      onChange={(value) => onFilterChange({ search: value || undefined })}
      onClear={() => onFilterChange({ search: undefined })}
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input className="w-full md:w-48" placeholder="Search..." />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}

interface MobileSettingsProps {
  filters: ArticleFilters;
  onFilterChange: (filters: Partial<ArticleFilters>) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function MobileSettings({ filters, onFilterChange, view, onViewChange }: MobileSettingsProps) {
  const currentSort = filters.sort || "date-desc";
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
                  {/* Sort */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted mb-3">Sort by</h3>
                    <div className="flex flex-col gap-1">
                      {sortOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            onFilterChange({ sort: opt.value as ArticleFilters["sort"] });
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
                    <ToggleButtonGroup
                      selectionMode="single"
                      selectedKeys={new Set([view])}
                      onSelectionChange={(keys) => {
                        const selected = [...keys][0] as ViewMode | undefined;
                        if (selected) {
                          onViewChange(selected);
                          drawerState.close();
                        }
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
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
