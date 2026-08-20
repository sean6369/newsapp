import type { ViewMode } from "@/components/ArticleGrid";

/**
 * Grid/list preference, persisted so a reload doesn't reset it. Each page keeps
 * its own cookie: they open on different defaults (grid vs list) and a choice
 * made while searching shouldn't rewrite the home feed's layout.
 */
export const FEED_VIEW_COOKIE = "feed-view";
export const SEARCH_VIEW_COOKIE = "search-view";
export const LIBRARY_VIEW_COOKIE = "library-view";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Client-side only — writes `document.cookie`. */
export function setViewCookie(name: string, value: ViewMode) {
  document.cookie = `${name}=${value};path=/;max-age=${ONE_YEAR};SameSite=Lax`;
}

export function parseViewCookie(value: string | undefined, fallback: ViewMode): ViewMode {
  return value === "grid" || value === "list" ? value : fallback;
}
