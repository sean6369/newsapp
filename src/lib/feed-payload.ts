import { queryArticles, getArticleDates, getLastFetchTime } from "@/lib/db/queries";
import { groupByStory } from "@/lib/group-stories";
import type { ArticleFilters, ArticleWithRelated } from "@/lib/types";

export interface FeedPayload {
  articles: ArticleWithRelated[];
  dates: string[];
  lastFetchTime: string | null;
}

/** The one place a feed payload is assembled. /api/articles serves it to the
 *  client hook; the feed page awaits it directly to server-render the first
 *  screen. Both go through here so the page and the route cannot drift into
 *  answering the same filters differently. */
export async function getFeedPayload(filters: ArticleFilters): Promise<FeedPayload> {
  const [dates, lastFetchTime] = await Promise.all([getArticleDates(), getLastFetchTime()]);

  // A feed request that names no day means the newest one, not the whole
  // archive. The client asks that way on every cold load — the date navigator
  // leaves the newest day out of the URL, so there is nothing to read a date
  // from until the first response comes back with one — and answering it
  // literally means sending thousands of articles across every day on record
  // for a page that renders one day of them.
  //
  // Search is the exception: reaching across days is the point of it.
  const date = filters.date ?? (filters.search ? undefined : dates[0]);

  const rawArticles = await queryArticles({ ...filters, date });
  const articles = groupByStory(rawArticles);

  return { articles, dates, lastFetchTime };
}
