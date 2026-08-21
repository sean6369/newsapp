import { LIBRARY_FEED, type FeedType } from "./types";

/**
 * A feed the pipeline actually fetches.
 *
 * `library` is excluded for the reason it exists at all: it is the bucket
 * hand-clipped articles land in, not a section anything is pulled from, so it
 * can never have a source behind it.
 */
export type NewsFeed = Exclude<FeedType, typeof LIBRARY_FEED>;

/**
 * The news feeds, in the order the tabs and the settings page read them.
 *
 * The single list both places draw on — the feed filter's tabs are this plus
 * an "All" entry (see `FEED_OPTIONS`), and the settings page groups sources
 * under these headings. Two hand-kept copies drifted the moment a feed was
 * renamed.
 */
export const NEWS_FEEDS: readonly { value: NewsFeed; label: string }[] = [
  { value: "singapore", label: "Singapore" },
  { value: "world", label: "World" },
  { value: "asia", label: "Asia" },
  { value: "finance", label: "Finance" },
  { value: "ai", label: "AI" },
  { value: "tech", label: "Tech" },
];

/**
 * How a source is read.
 *
 * Not cosmetic: each kind is a different fetcher with different parsing.
 * `tldr` is scraped from a dated digest page rather than pulled from RSS,
 * which is why its `url` is the section landing page and not a feed endpoint.
 */
export type SourceKind = "tldr" | "cna" | "st";

export interface FeedSource {
  /**
   * Stable key, stored in `feed_sources` when the reader turns one off.
   *
   * Never regenerate these from the outlet or URL: an id that changes silently
   * orphans the row recording that the reader disabled it, turning the source
   * back on behind their back.
   */
  id: string;
  outlet: string;
  feed: NewsFeed;
  kind: SourceKind;
  /**
   * The RSS endpoint, for `cna` and `st`. TLDR has none — its digests are
   * scraped per day, so this is the section page a reader would recognise and
   * the dated URLs are derived from `feed` at fetch time.
   */
  url: string;
}

/**
 * Every source the pipeline knows how to pull, whether or not it is on.
 *
 * The registry is the source of truth for *what exists*; the `feed_sources`
 * table only records what the reader has switched off. Adding a source here is
 * all it takes to make it live — no migration, no seed row — and it arrives
 * enabled, which is the right default for something someone just added on
 * purpose.
 */
export const FEED_SOURCES: readonly FeedSource[] = [
  {
    id: "tldr-tech",
    outlet: "TLDR",
    feed: "tech",
    kind: "tldr",
    url: "https://tldr.tech/tech",
  },
  {
    id: "tldr-ai",
    outlet: "TLDR",
    feed: "ai",
    kind: "tldr",
    url: "https://tldr.tech/ai",
  },
  {
    id: "cna-singapore",
    outlet: "CNA",
    feed: "singapore",
    kind: "cna",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
  },
  {
    id: "cna-world",
    outlet: "CNA",
    feed: "world",
    kind: "cna",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311",
  },
  {
    id: "cna-asia",
    outlet: "CNA",
    feed: "asia",
    kind: "cna",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511",
  },
  {
    id: "cna-finance",
    outlet: "CNA",
    feed: "finance",
    kind: "cna",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936",
  },
  {
    id: "st-singapore",
    outlet: "The Straits Times",
    feed: "singapore",
    kind: "st",
    url: "https://www.straitstimes.com/news/singapore/rss.xml",
  },
  {
    id: "st-world",
    outlet: "The Straits Times",
    feed: "world",
    kind: "st",
    url: "https://www.straitstimes.com/news/world/rss.xml",
  },
  {
    id: "st-asia",
    outlet: "The Straits Times",
    feed: "asia",
    kind: "st",
    url: "https://www.straitstimes.com/news/asia/rss.xml",
  },
  {
    id: "st-finance",
    outlet: "The Straits Times",
    feed: "finance",
    kind: "st",
    url: "https://www.straitstimes.com/news/business/rss.xml",
  },
];

export interface FeedSourceState extends FeedSource {
  enabled: boolean;
}

/** True when `id` names a source the pipeline knows about. */
export function isKnownSourceId(id: string): boolean {
  return FEED_SOURCES.some((s) => s.id === id);
}

/**
 * The registry with the reader's switches applied.
 *
 * Overrides are sparse on purpose — a source nobody has touched has no row —
 * so anything missing from the map resolves to on. That keeps "never
 * configured" and "explicitly enabled" the same state, which is what lets a
 * newly added source appear without anyone having to seed it.
 */
export function resolveFeedSources(
  overrides: Map<string, boolean>
): FeedSourceState[] {
  return FEED_SOURCES.map((source) => ({
    ...source,
    enabled: overrides.get(source.id) ?? true,
  }));
}

export interface FeedSourceGroup {
  feed: NewsFeed;
  label: string;
  sources: FeedSourceState[];
}

/**
 * Sources arranged under the feed they file into, in `NEWS_FEEDS` order.
 *
 * The feed is the grouping the reader thinks in — "am I still getting
 * Singapore news, and from whom" — rather than the outlet, which would split
 * one question across four sections. Feeds with no source at all are dropped:
 * an empty heading would read as a section that had been turned off.
 */
export function groupSourcesByFeed(
  sources: FeedSourceState[]
): FeedSourceGroup[] {
  return NEWS_FEEDS.map(({ value, label }) => ({
    feed: value,
    label,
    sources: sources.filter((s) => s.feed === value),
  })).filter((group) => group.sources.length > 0);
}
