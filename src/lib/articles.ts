import slugify from "slugify";
import { createHash } from "node:crypto";
import type { RawArticle, Article } from "./types";

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Extract a stable source identifier from an article URL.
 *
 * - CNA: numeric article ID from URL end (e.g., "cna:6184396")
 * - ST: URL pathname (e.g., "st:/singapore/courts-crime/jail-for-2-men-...")
 * - Others: full URL as-is
 */
export function extractSourceId(url: string): string {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, "");

    if (hostname === "channelnewsasia.com") {
      const match = u.pathname.match(/-(\d{5,})$/);
      if (match) return `cna:${match[1]}`;
    }

    if (hostname === "straitstimes.com") {
      return `st:${u.pathname}`;
    }

    return url;
  } catch {
    return url;
  }
}

// Short, stable, effectively-unique suffix from the article's source id.
// Same sourceId → same suffix; sourceId is already unique-indexed, so distinct
// articles get distinct suffixes even when titles are identical. 10 hex chars
// (~40 bits) gives ample collision headroom at news-app volume.
function slugHash(sourceId: string): string {
  return createHash("sha1").update(sourceId).digest("hex").slice(0, 10);
}

export function makeSlug(title: string, sourceId: string): string {
  const base = slugify(title, { lower: true, strict: true }).slice(0, 80);
  const suffix = slugHash(sourceId);
  return base ? `${base}-${suffix}` : `article-${suffix}`;
}

export function buildArticle(
  rawArticle: RawArticle,
  clippedContent: string | null
): { article: Article; content: string } {
  const slug = makeSlug(rawArticle.title, rawArticle.sourceId);

  const isHNDiscussion = rawArticle.sourceUrl.includes("news.ycombinator.com/item");
  const content = clippedContent
    ? clippedContent
    : isHNDiscussion
      ? `[View discussion on Hacker News](${rawArticle.sourceUrl})`
      : `[Read the original article](${rawArticle.sourceUrl})`;

  const article: Article = {
    slug,
    title: rawArticle.title,
    sourceUrl: rawArticle.sourceUrl,
    sourceDomain: extractDomain(rawArticle.sourceUrl),
    summary: rawArticle.summary,
    category: rawArticle.category,
    feed: rawArticle.feed,
    date: rawArticle.date,
    readingTime: rawArticle.readingTime,
    clipped: clippedContent !== null,
    relevanceScore: null,
    storyGroup: null,
    createdAt: new Date().toISOString(),
    sourceId: rawArticle.sourceId,
    updatedAt: null,
  };

  return { article, content };
}

export function buildArticleMarkdownHeader(article: {
  title: string;
  sourceDomain: string;
  sourceUrl: string;
  date: string;
  feed: string;
  readingTime: number;
}): string {
  return [
    `# ${article.title}`,
    "",
    `- **Source:** [${article.sourceDomain}](${article.sourceUrl})`,
    `- **Date:** ${article.date}`,
    `- **Feed:** ${article.feed}`,
    `- **Reading time:** ${article.readingTime} min`,
    "",
    "---",
    "",
  ].join("\n");
}
