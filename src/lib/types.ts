export type FeedType = "tech" | "ai" | "singapore" | "world" | "asia" | "finance";

export interface RawArticle {
  title: string;
  sourceUrl: string;
  summary: string;
  category: string;
  readingTime: number;
  feed: FeedType;
  date: string;
  sourceId: string;
}

export interface Article {
  slug: string;
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  summary: string;
  category: string;
  feed: FeedType;
  date: string;
  readingTime: number;
  clipped: boolean;
  relevanceScore: number | null;
  storyGroup: string | null;
  createdAt: string;
  sourceId: string;
  updatedAt: string | null;
}

export interface ArticleWithRelated extends Article {
  relatedArticles?: Article[];
}

export interface SearchSource {
  title: string;
  url: string;
}

/**
 * One retrieval the model performed, surfaced so the page can show its
 * working. A dedicated page has room to show what was searched and what came
 * back, which is the difference between a chatbot bolted on and something
 * that reads as part of the app.
 */
export interface AskStep {
  tool: "search_articles" | "get_article";
  /** Human-readable: the query and hit count, or the article title. */
  detail: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchSource[];
  /** Archive searches behind this reply, in the order they ran. */
  steps?: AskStep[];
  /** Archive articles the reply drew on, for rendering as cards. */
  articles?: RetrievedArticle[];
}

/**
 * An article returned by retrieval, as far as the client is concerned.
 *
 * Defined here rather than in `lib/retrieval` so the client can name the shape
 * without importing a module that reaches for the database — and defined only
 * once, since two identical hand-kept copies drift.
 */
export interface RetrievedArticle {
  slug: string;
  title: string;
  summary: string;
  date: string;
  sourceDomain: string;
  feed: string;
  alsoReportedBy: string[];
}

export interface ArticleFilters {
  feed?: FeedType | "all";
  date?: string;
  search?: string;
  sort?: "date-desc" | "date-asc" | "relevance";
}

export type SearchSortMode = "relevance" | "date-desc" | "date-asc";

/** Rows per search page. Shared so the server's first page and the client's
 *  "load more" pages advance the offset by the same amount. */
export const SEARCH_PAGE_SIZE = 40;

/**
 * Sort used for the server-rendered first page and the client's initial state.
 * These must agree: the client skips the first fetch and reuses the server's
 * rows, so a mismatch would render rank-ordered results under date headings,
 * shattering the timeline into one group per article. Change it here only.
 */
export const DEFAULT_SEARCH_SORT: SearchSortMode = "relevance";

/**
 * How the results were produced. `fuzzy` means full-text found nothing and we
 * fell back to trigram title matching, so the UI should say so.
 */
export type SearchMode = "fts" | "fuzzy" | "empty";

/** Sentinels wrapped around matched terms by `ts_headline`. Parsed, not injected as HTML. */
export const HIGHLIGHT_START = "[[HL]]";
export const HIGHLIGHT_END = "[[/HL]]";

export interface SearchResultArticle extends Article {
  /** Matched context from the body with terms wrapped in highlight sentinels. */
  snippet: string | null;
  /** The full title with matched terms wrapped in the same sentinels. */
  titleHighlight: string | null;
  rank: number;
  relatedArticles?: SearchResultArticle[];
}

export interface SearchFilters {
  query: string;
  feed?: FeedType | "all";
  /** Inclusive `YYYY-MM-DD` bounds against `articles.date`. */
  from?: string;
  to?: string;
  sort?: SearchSortMode;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  /** Matching articles, with same-story duplicates collapsed into `relatedArticles`. */
  results: SearchResultArticle[];
  /** Total matching articles before story grouping and pagination. */
  total: number;
  /**
   * Rows this page consumed *before* grouping. Story grouping means
   * `results.length` is usually smaller, so paging must advance by this
   * instead — otherwise the next page re-reads rows already shown.
   */
  rowCount: number;
  mode: SearchMode;
}

export interface PipelineResult {
  date: string;
  totalFound: number;
  newArticles: number;
  clipped: number;
  failedClips: number;
  skippedExisting: number;
}

export const FEED_URLS = {
  tech: "https://tldr.tech/api/rss/tech",
  ai: "https://tldr.tech/api/rss/ai",
} as const;

export const CNA_FEED_URL =
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416";

export const CNA_WORLD_FEED_URL =
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311";

export const CNA_ASIA_FEED_URL =
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511";

export const CNA_FINANCE_FEED_URL =
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936";

export const ST_FEED_URL =
  "https://www.straitstimes.com/news/singapore/rss.xml";

export const ST_WORLD_FEED_URL =
  "https://www.straitstimes.com/news/world/rss.xml";

export const ST_ASIA_FEED_URL =
  "https://www.straitstimes.com/news/asia/rss.xml";

export const ST_BUSINESS_FEED_URL =
  "https://www.straitstimes.com/news/business/rss.xml";
