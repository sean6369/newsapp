import type { Article } from "@/lib/types";

/**
 * Collapse articles that share a `storyGroup` into a single primary article
 * with its duplicates attached as `relatedArticles`.
 *
 * Generic over the article shape so callers carrying extra per-row data (e.g.
 * search rank/snippet) keep it on the primary after grouping. The first
 * occurrence in the input wins, so the caller's sort order decides which
 * article represents the story.
 *
 * Feed scoping is the caller's job, not this function's: both callers narrow
 * by feed in SQL, so when a feed tab is active every row here already shares
 * that feed and there is no cross-feed case left to special-case.
 */
export function groupByStory<T extends Article>(
  articles: T[]
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

  for (const article of articles) {
    if (seen.has(article.slug)) continue;
    seen.add(article.slug);

    if (article.storyGroup) {
      const group = storyGroupMap.get(article.storyGroup)!;
      const related = group.filter((a) => a.slug !== article.slug);

      for (const r of related) seen.add(r.slug);
      result.push({ ...article, relatedArticles: related.length > 0 ? related : undefined });
    } else {
      result.push(article);
    }
  }

  return result;
}

type WithRelated<T> = T & { relatedArticles?: T[] };

/**
 * Fold a newly loaded page of results into the ones already on screen.
 *
 * `groupByStory` runs per page, so the copies of one story can straddle a page
 * boundary: page 1 collapsed the copies it could see, and page 2 brings back
 * another copy of that same story as its own result. Keyed on slug alone that
 * copy looks new — it is a different article — and lands as a second card for a
 * story already showing. It belongs in the existing card's source switcher
 * instead, and dropping it would lose its search highlighting.
 *
 * Offsets advance by rows consumed rather than cards rendered, so the same slug
 * only reappears when the pipeline inserts mid-session and shifts rows under
 * the pagination. That case is skipped outright.
 */
export function mergeStoryPage<T extends Article>(
  prev: WithRelated<T>[],
  incoming: WithRelated<T>[]
): WithRelated<T>[] {
  const storyKey = (a: T) => a.storyGroup ?? a.slug;

  // Every slug on screen, primaries and attached copies alike.
  const shown = new Set<string>();
  for (const a of prev) {
    shown.add(a.slug);
    for (const rel of a.relatedArticles ?? []) shown.add(rel.slug);
  }

  const indexByStory = new Map<string, number>();
  prev.forEach((a, i) => indexByStory.set(storyKey(a), i));

  const next = [...prev];
  for (const article of incoming) {
    if (shown.has(article.slug)) continue;

    const at = indexByStory.get(storyKey(article));
    if (at === undefined) {
      indexByStory.set(storyKey(article), next.length);
      next.push(article);
      shown.add(article.slug);
      for (const rel of article.relatedArticles ?? []) shown.add(rel.slug);
      continue;
    }

    // Flattened onto the existing primary rather than nested: the source
    // switcher reads one level of `relatedArticles`, so a copy carrying its
    // own would silently disappear.
    const { relatedArticles: carried, ...self } = article;
    const additions = [self as WithRelated<T>, ...(carried ?? [])].filter(
      (a) => !shown.has(a.slug)
    );
    for (const a of additions) shown.add(a.slug);

    const primary = next[at];
    next[at] = {
      ...primary,
      relatedArticles: [...(primary.relatedArticles ?? []), ...additions],
    };
  }

  return next;
}
