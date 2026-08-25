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

/** Words a minute, for the reading-time estimate. The usual prose figure. */
const WORDS_PER_MINUTE = 200;

/**
 * Markdown to plain prose.
 *
 * Used for counting words and for the library's summary fallback — both want
 * the sentences without the syntax carrying them.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*/gm, "") // leading images
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reading-time estimate for a clipped body, in minutes. Zero for no body.
 *
 * Lives here rather than beside the paste flow because every path that can
 * supply a body needs it: ingest, a pasted link, the pipeline's re-clip after
 * a feed retitles something, and the retry pass. A row stored while its clip
 * was failing holds `0`, and whichever path later supplies the text has to
 * recompute this with it or the card keeps hiding the "N min" chip.
 */
export function estimateReadingTime(markdown: string): number {
  const words = stripMarkdown(markdown).split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
}

/**
 * What an article's body is when there is no body — the one link the reader
 * can still follow.
 *
 * Shared so that a clip which is later withdrawn (see `lib/reclip.ts`) lands
 * back on exactly the text it would have had if the clip had failed the first
 * time, rather than a second stub that only looks the same.
 */
export function stubContent(sourceUrl: string): string {
  return sourceUrl.includes("news.ycombinator.com/item")
    ? `[View discussion on Hacker News](${sourceUrl})`
    : `[Read the original article](${sourceUrl})`;
}

export function buildArticle(
  rawArticle: RawArticle,
  clippedContent: string | null
): { article: Article; content: string } {
  const slug = makeSlug(rawArticle.title, rawArticle.sourceId);

  const content = clippedContent ?? stubContent(rawArticle.sourceUrl);

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
    // The pipeline only ever builds feed articles; clips are built in
    // `lib/library.ts`, which sets these the other way. A feed article can
    // still be saved later — that flips `library` without coming back here.
    library: false,
    savedAt: null,
    relevanceScore: null,
    storyGroup: null,
    createdAt: new Date().toISOString(),
    sourceId: rawArticle.sourceId,
    updatedAt: null,
    // Just ingested; nobody has opened it.
    read: false,
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
