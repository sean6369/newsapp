import type { Article } from "@/lib/types";

/**
 * Collapse articles that share a `storyGroup` into a single primary article
 * with its duplicates attached as `relatedArticles`.
 *
 * Generic over the article shape so callers carrying extra per-row data (e.g.
 * search rank/snippet) keep it on the primary after grouping. The first
 * occurrence in the input wins, so the caller's sort order decides which
 * article represents the story.
 */
export function groupByStory<T extends Article>(
  articles: T[],
  feedFilter?: string
): (T & { relatedArticles?: T[] })[] {
  // Build a map of storyGroup → all articles in that group
  const storyGroupMap = new Map<string, T[]>();
  for (const article of articles) {
    if (article.storyGroup) {
      const group = storyGroupMap.get(article.storyGroup) || [];
      group.push(article);
      storyGroupMap.set(article.storyGroup, group);
    }
  }

  // Walk the original array in order (preserving DB sort) and attach
  // related articles. Skip secondary articles that were already attached.
  const seen = new Set<string>();
  const result: (T & { relatedArticles?: T[] })[] = [];
  const isFiltered = feedFilter && feedFilter !== "all";

  for (const article of articles) {
    if (seen.has(article.slug)) continue;
    seen.add(article.slug);

    if (article.storyGroup) {
      const group = storyGroupMap.get(article.storyGroup)!;
      const related = group.filter((a) => a.slug !== article.slug);

      // Cross-feed groups only merge in the "All" tab.
      // In a specific feed tab, show each article individually.
      const allCrossFeed = related.length > 0 && related.every((a) => a.feed !== article.feed);
      if (allCrossFeed && isFiltered) {
        result.push(article);
      } else {
        for (const r of related) seen.add(r.slug);
        result.push({ ...article, relatedArticles: related.length > 0 ? related : undefined });
      }
    } else {
      result.push(article);
    }
  }

  return result;
}
