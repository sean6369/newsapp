/**
 * Which section an article belongs to.
 *
 * `library` is the odd one out: it is not a source the pipeline fetches but the
 * bucket every hand-clipped article lands in, so it never appears in the feed
 * filter's tabs or in the feeds the Ask tools can scope to. It exists in the
 * union because `articles.feed` is `NOT NULL` and a clip has to say something
 * honest there.
 */
export type FeedType = "tech" | "ai" | "singapore" | "world" | "asia" | "finance" | "library";

/** The `feed` value every hand-clipped article carries. */
export const LIBRARY_FEED = "library" as const;

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
  /**
   * True when the article is in the reader's library. Independent of where it
   * came from — a feed article can be saved without leaving the feed. Origin
   * is `feed === LIBRARY_FEED`.
   */
  library: boolean;
  /** When it was added to the library; null if it never was. */
  savedAt: string | null;
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
 * One past conversation as the history drawer lists it.
 *
 * Deliberately without `messages`. The drawer shows every chat the reader has
 * ever had, and sending each one's full thread — retrieval steps, article
 * cards and all — to render a list of titles would make opening the drawer the
 * most expensive request in the app. The thread arrives only when one is
 * opened, via `Conversation`.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  /** When the last exchange landed, ISO-8601. Also the list's sort order. */
  updatedAt: string;
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
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
