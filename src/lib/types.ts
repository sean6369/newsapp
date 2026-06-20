export interface TLDRArticle {
  title: string;
  sourceUrl: string;
  summary: string;
  category: string;
  readingTime: number;
  feed: "tech" | "ai" | "singapore" | "world" | "asia" | "finance";
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
  feed: "tech" | "ai" | "singapore" | "world" | "asia" | "finance";
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchSource[];
}

export interface ArticleFilters {
  feed?: "tech" | "ai" | "singapore" | "world" | "asia" | "finance" | "all";
  date?: string;
  search?: string;
  sort?: "date-desc" | "date-asc" | "relevance";
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

export type FeedType = keyof typeof FEED_URLS;
