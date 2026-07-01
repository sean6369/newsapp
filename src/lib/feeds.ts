import RSSParser from "rss-parser";
import * as cheerio from "cheerio";
import type { TLDRArticle, FeedType } from "./types";
import {
  FEED_URLS,
  CNA_FEED_URL,
  ST_FEED_URL,
} from "./types";
import { extractSourceId } from "./articles";

const parser = new RSSParser();

interface DigestInfo {
  url: string;
  date: string;
  feed: FeedType;
}

export async function fetchDigestUrls(
  targetDate?: string
): Promise<DigestInfo[]> {
  const results: DigestInfo[] = [];

  for (const [feed, feedUrl] of Object.entries(FEED_URLS)) {
    try {
      const rss = await parser.parseURL(feedUrl);
      let found = false;

      for (const item of rss.items) {
        if (!item.link) continue;

        // Extract date from URL path: /tech/2026-06-11 or /ai/2026-06-11
        const match = item.link.match(/\/(\d{4}-\d{2}-\d{2})$/);
        if (!match) continue;

        const date = match[1];
        if (targetDate && date !== targetDate) continue;

        results.push({
          url: item.link,
          date,
          feed: feed as FeedType,
        });
        found = true;
      }

      // Fallback: if a target date was requested but not found in the RSS feed,
      // construct the digest URL directly (TLDR pages stay up after RSS rotates)
      if (targetDate && !found) {
        const directUrl = `https://tldr.tech/${feed}/${targetDate}`;
        console.log(`[feeds] RSS miss for ${feed}/${targetDate}, trying direct URL`);
        results.push({
          url: directUrl,
          date: targetDate,
          feed: feed as FeedType,
        });
      }
    } catch (error) {
      console.error(`[feeds] Failed to fetch RSS for ${feed}:`, error);

      // If RSS fetch failed and we have a target date, try the direct URL
      if (targetDate) {
        const directUrl = `https://tldr.tech/${feed}/${targetDate}`;
        console.log(`[feeds] RSS failed for ${feed}, trying direct URL for ${targetDate}`);
        results.push({
          url: directUrl,
          date: targetDate,
          feed: feed as FeedType,
        });
      }
    }
  }

  return results;
}

export async function scrapeDigestPage(
  url: string,
  feed: FeedType,
  date: string
): Promise<TLDRArticle[]> {
  const articles: TLDRArticle[] = [];

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsApp/1.0)",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[feeds] Digest page returned ${response.status}: ${url}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let currentCategory = "Uncategorized";

    // TLDR pages use sections with headers for categories and article elements for content
    $("article, header").each((_, el) => {
      const $el = $(el);

      if (el.tagName === "header") {
        const headerText = $el.text().trim();
        if (headerText && !headerText.includes("TLDR")) {
          currentCategory = headerText;
        }
        return;
      }

      // This is an article element
      const $link = $el.find("a.font-bold").first();
      if (!$link.length) return;

      const rawHref = $link.attr("href");
      if (!rawHref || rawHref.includes("tldr.tech/signup") || rawHref.startsWith("mailto:")) return;

      const titleEl = $link.find("h3").first();
      let rawTitle = titleEl.length ? titleEl.text().trim() : $link.text().trim();

      // Skip sponsor/ad articles
      if (
        currentCategory.toLowerCase().includes("sponsor") ||
        rawTitle.toLowerCase().includes("(sponsor)")
      ) {
        return;
      }

      // Strip UTM params from source URL
      let sourceUrl = rawHref;
      try {
        const urlObj = new URL(rawHref);
        [...urlObj.searchParams.keys()]
          .filter((k) => k.startsWith("utm_"))
          .forEach((k) => urlObj.searchParams.delete(k));
        sourceUrl = urlObj.toString();
      } catch {
        // Keep raw href if URL parsing fails
      }

      // Extract reading time from title: "(X minute read)"
      let readingTime = 0;
      const timeMatch = rawTitle.match(/\((\d+)\s*minute\s*read\)/i);
      if (timeMatch) {
        readingTime = parseInt(timeMatch[1], 10);
        rawTitle = rawTitle.replace(timeMatch[0], "").trim();
      }

      const $summary = $el.find(".newsletter-html").first();
      const summary = $summary.text().trim();

      if (!rawTitle || !summary) return;

      articles.push({
        title: rawTitle,
        sourceUrl,
        summary,
        category: currentCategory,
        readingTime,
        feed,
        date,
        sourceId: extractSourceId(sourceUrl),
      });
    });
  } catch (error) {
    console.error(`[feeds] Failed to scrape digest page ${url}:`, error);
  }

  return articles;
}

// Mapping of feed → CNA section names to filter out from categories
const CNA_SECTION_FILTERS: Record<string, string[]> = {
  singapore: ["Singapore", "CNA Lifestyle", "8days"],
  world: ["World", "CNA Lifestyle"],
  asia: ["Asia", "East Asia", "CNA Lifestyle"],
  finance: ["Business", "CNA Lifestyle"],
};

// Standard URL-path → feed mappings shared by CNA and ST
const FEED_PATH_MAPPINGS: Array<{ prefix: string; feed: TLDRArticle["feed"] }> = [
  { prefix: "/business/", feed: "finance" },
  { prefix: "/world/", feed: "world" },
  { prefix: "/asia/", feed: "asia" },
  { prefix: "/singapore/", feed: "singapore" },
];

interface RSSFeedOptions {
  source: string;
  feedUrl: string;
  feed: TLDRArticle["feed"];
  /** Extra URL path → feed mappings beyond the standard set */
  extraPathMappings?: Array<{ prefix: string; feed: TLDRArticle["feed"] }>;
  /** Extract category from RSS item (defaults to using defaultCategory) */
  parseCategory?: (item: RSSParser.Item, defaultCategory: string) => string;
  /** Transform raw summary text (e.g. strip HTML) */
  transformSummary?: (raw: string) => string;
}

async function fetchRSSArticles(options: RSSFeedOptions): Promise<TLDRArticle[]> {
  const { source, feedUrl, feed, extraPathMappings, parseCategory, transformSummary } = options;
  const articles: TLDRArticle[] = [];
  const defaultCategory = feed === "finance" ? "Business" : feed.charAt(0).toUpperCase() + feed.slice(1);
  const allMappings = [...FEED_PATH_MAPPINGS, ...(extraPathMappings ?? [])];

  try {
    const rss = await parser.parseURL(feedUrl);

    for (const item of rss.items) {
      if (!item.link || !item.title) continue;

      // Parse pubDate to YYYY-MM-DD in SGT (UTC+8)
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      const sgtDate = new Date(pubDate.getTime() + 8 * 60 * 60 * 1000);
      const date = sgtDate.toISOString().split("T")[0];

      const rawSummary = item.contentSnippet || item.content || item.title;
      const summary = transformSummary ? transformSummary(rawSummary) : rawSummary;

      const category = parseCategory
        ? parseCategory(item, defaultCategory)
        : defaultCategory;

      // Infer feed from URL path — RSS feeds can include cross-section articles
      const urlPath = new URL(item.link).pathname;
      let resolvedFeed: TLDRArticle["feed"] = feed;
      for (const mapping of allMappings) {
        if (urlPath.startsWith(mapping.prefix)) {
          resolvedFeed = mapping.feed;
          break;
        }
      }

      articles.push({
        title: item.title.trim(),
        sourceUrl: item.link,
        summary: summary.trim(),
        category,
        readingTime: 0,
        feed: resolvedFeed,
        date,
        sourceId: extractSourceId(item.link),
      });
    }

    console.log(`[feeds] Fetched ${articles.length} ${source} ${feed} articles`);
  } catch (error) {
    console.error(`[feeds] Failed to fetch ${source} ${feed} RSS:`, error);
  }

  return articles;
}

export function fetchCNAArticles(
  feedUrl: string = CNA_FEED_URL,
  feed: TLDRArticle["feed"] = "singapore"
): Promise<TLDRArticle[]> {
  const sectionFilters = CNA_SECTION_FILTERS[feed] || [];
  return fetchRSSArticles({
    source: "CNA",
    feedUrl,
    feed,
    extraPathMappings: [{ prefix: "/east-asia/", feed: "asia" }],
    parseCategory: (item, defaultCategory) => {
      const rawCats = (item.categories?.[0] || defaultCategory)
        .split(",")
        .map((c: string) => c.trim())
        .filter((c: string) => c && !sectionFilters.includes(c));
      return rawCats[0] || defaultCategory;
    },
  });
}

export function fetchSTArticles(
  feedUrl: string = ST_FEED_URL,
  feed: TLDRArticle["feed"] = "singapore"
): Promise<TLDRArticle[]> {
  return fetchRSSArticles({
    source: "ST",
    feedUrl,
    feed,
    transformSummary: (raw) => raw.replace(/<[^>]*>/g, ""),
  });
}

