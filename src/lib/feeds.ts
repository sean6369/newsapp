import RSSParser from "rss-parser";
import * as cheerio from "cheerio";
import type { RawArticle, FeedType } from "./types";
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

export function fetchDigestUrls(targetDate: string): DigestInfo[] {
  // TLDR usually hasn't published "today's" digest yet when the hourly cron
  // runs early in the day (the dated URL 307s to the undated feed page until
  // then), so also re-check yesterday's date each run to self-heal once it
  // does go up. Already-inserted articles are deduped by sourceId downstream.
  const yesterday = new Date(targetDate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDate = yesterday.toISOString().split("T")[0];

  return Object.keys(FEED_URLS).flatMap((feed) => [
    {
      url: `https://tldr.tech/${feed}/${targetDate}`,
      date: targetDate,
      feed: feed as FeedType,
    },
    {
      url: `https://tldr.tech/${feed}/${yesterdayDate}`,
      date: yesterdayDate,
      feed: feed as FeedType,
    },
  ]);
}

export async function scrapeDigestPage(
  url: string,
  feed: FeedType,
  date: string
): Promise<RawArticle[]> {
  const articles: RawArticle[] = [];

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

    // TLDR redirects the dated URL to the undated feed page (e.g. /tech)
    // when that day's digest isn't published yet — that page has no
    // <article> elements, so bail out with a clear log instead of silently
    // parsing zero articles from the wrong page.
    if (response.redirected && !new URL(response.url).pathname.endsWith(date)) {
      console.log(`[feeds] Digest not yet published, skipping: ${url}`);
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
const FEED_PATH_MAPPINGS: Array<{ prefix: string; feed: FeedType }> = [
  { prefix: "/business/", feed: "finance" },
  { prefix: "/world/", feed: "world" },
  { prefix: "/asia/", feed: "asia" },
  { prefix: "/singapore/", feed: "singapore" },
];

interface RSSFeedOptions {
  source: string;
  feedUrl: string;
  feed: FeedType;
  /** Extra URL path → feed mappings beyond the standard set */
  extraPathMappings?: Array<{ prefix: string; feed: FeedType }>;
  /** Extract category from RSS item (defaults to using defaultCategory) */
  parseCategory?: (item: RSSParser.Item, defaultCategory: string) => string;
  /** Transform raw summary text (e.g. strip HTML) */
  transformSummary?: (raw: string) => string;
}

async function fetchRSSArticles(options: RSSFeedOptions): Promise<RawArticle[]> {
  const { source, feedUrl, feed, extraPathMappings, parseCategory, transformSummary } = options;
  const articles: RawArticle[] = [];
  const defaultCategory = feed === "finance" ? "Business" : feed.charAt(0).toUpperCase() + feed.slice(1);
  const allMappings = [...FEED_PATH_MAPPINGS, ...(extraPathMappings ?? [])];

  try {
    const rss = await parser.parseURL(feedUrl);

    for (const item of rss.items) {
      if (!item.link || !item.title) continue;

      // Parse pubDate to YYYY-MM-DD in SGT
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      const date = pubDate.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

      const rawSummary = item.contentSnippet || item.content || item.title;
      const summary = transformSummary ? transformSummary(rawSummary) : rawSummary;

      const category = parseCategory
        ? parseCategory(item, defaultCategory)
        : defaultCategory;

      // Infer feed from URL path — RSS feeds can include cross-section articles
      const urlPath = new URL(item.link).pathname;
      let resolvedFeed: FeedType = feed;
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
  feed: FeedType = "singapore"
): Promise<RawArticle[]> {
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
  feed: FeedType = "singapore"
): Promise<RawArticle[]> {
  return fetchRSSArticles({
    source: "ST",
    feedUrl,
    feed,
    transformSummary: (raw) => raw.replace(/<[^>]*>/g, ""),
  });
}

