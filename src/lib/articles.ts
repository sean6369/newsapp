import slugify from "slugify";
import type { TLDRArticle, Article } from "./types";

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

export function makeSlug(title: string, domain?: string, feed?: string): string {
  const base = slugify(title, { lower: true, strict: true }).slice(0, 80);
  const parts = [base];
  if (feed) parts.push(feed);
  if (domain) parts.push(domain.replace(/\./g, "-"));
  return parts.join("-").slice(0, 120);
}

export function buildArticle(
  tldrArticle: TLDRArticle,
  clippedContent: string | null
): { article: Article; content: string } {
  const domain = extractDomain(tldrArticle.sourceUrl);
  const slug = makeSlug(tldrArticle.title, domain, tldrArticle.feed);

  const isHNDiscussion = tldrArticle.sourceUrl.includes("news.ycombinator.com/item");
  const content = clippedContent
    ? clippedContent
    : isHNDiscussion
      ? `[View discussion on Hacker News](${tldrArticle.sourceUrl})`
      : `[Read the original article](${tldrArticle.sourceUrl})`;

  const article: Article = {
    slug,
    title: tldrArticle.title,
    sourceUrl: tldrArticle.sourceUrl,
    sourceDomain: extractDomain(tldrArticle.sourceUrl),
    summary: tldrArticle.summary,
    category: tldrArticle.category,
    feed: tldrArticle.feed,
    date: tldrArticle.date,
    readingTime: tldrArticle.readingTime,
    clipped: clippedContent !== null,
    relevanceScore: null,
    storyGroup: null,
    createdAt: new Date().toISOString(),
    sourceId: tldrArticle.sourceId,
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
