import { JSDOM } from "jsdom";
import { clipArticle } from "./clipper";
import { estimateReadingTime, extractDomain, makeSlug, stripMarkdown, stubContent } from "./articles";
import { archiveToday } from "./dates";
import { LIBRARY_FEED, type Article } from "./types";

/**
 * Building a stored article out of nothing but a URL.
 *
 * The pipeline never has to do this: a feed item arrives with a title, a
 * summary, a publication date and a reading time already attached, and
 * `clipArticle` only supplies the body. A pasted link has none of that, so
 * everything the card and the reader show has to be recovered from the page
 * itself — and recovered without a model call, since the library is
 * reader-paced and unbudgeted while the Gemini quota is neither.
 */

/** Summary length before the trailing "…". Two lines on a card. */
const SUMMARY_LIMIT = 220;

/**
 * How long a page's own description has to be before it beats the article's
 * opening lines as a summary.
 *
 * A publisher's meta description is usually the better of the two — it was
 * written to describe the article. But plenty of sites serve one blurb for the
 * whole domain ("Empowering everyone to build reliable and efficient
 * software."), which is true of every page and tells the reader nothing about
 * the one they saved. Those are short; real per-article descriptions are not.
 */
const MIN_DESCRIPTION_LENGTH = 80;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

/**
 * Whether a host is one the server should refuse to fetch.
 *
 * Every other fetch in this app aims at a URL the app itself chose — a
 * configured feed, or a link found inside one. This is the only one aimed by
 * whoever is looking at the page, and the server sits inside a home network
 * with a database and other services on it, so an unfiltered fetch would let a
 * paste reach them and report back what it found.
 *
 * Literal addresses and obvious internal suffixes only: a public hostname that
 * resolves to a private address still gets through, which would need a
 * resolve-then-connect check to close. This is the proportionate half — it
 * stops the paste that names the target outright.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/\.(local|internal|home|lan)$/.test(host)) return true;
  if (host === "::1" || host.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(host)) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  return false;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * A readable title for a page that could not be clipped.
 *
 * Falls all the way back to the URL's own path rather than to an empty string:
 * a card with no title is a card the reader cannot identify, and the last path
 * segment of a news URL is nearly always the headline in kebab-case.
 */
function titleFromUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const slug = pathname.split("/").filter(Boolean).pop() ?? "";
    const words = slug
      .replace(/\.\w{2,5}$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\d{5,}\b/g, "")
      .trim();
    if (words.length > 2) return words.charAt(0).toUpperCase() + words.slice(1);
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The page's own title and description, without Readability.
 *
 * Only reached when clipping failed — a paywall, a 403, a page whose body
 * Readability could not find. The clip is stored anyway in that case, because
 * a saved link the reader can still open and identify is worth more than a
 * refusal, and this is what stops it from being an untitled row.
 */
async function fetchPageMeta(url: string): Promise<{ title: string; description: string }> {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!response.ok) return { title: "", description: "" };

    const { document } = new JSDOM(await response.text()).window;
    const meta = (selector: string) =>
      document.querySelector(selector)?.getAttribute("content")?.trim() ?? "";

    return {
      title:
        meta('meta[property="og:title"]') ||
        meta('meta[name="twitter:title"]') ||
        document.querySelector("title")?.textContent?.trim() ||
        "",
      description:
        meta('meta[property="og:description"]') || meta('meta[name="description"]'),
    };
  } catch (error) {
    console.warn(`[library] Metadata fetch failed for ${url}:`, error);
    return { title: "", description: "" };
  }
}

/**
 * Clips a pasted URL into an article row, ready to insert.
 *
 * Never rejects on a page it could not read. `clipped: false` is an outcome
 * the card and the reader both already render — it is how the feed stores a
 * paywalled article — so a failed clip becomes a saved link rather than an
 * error the reader has to act on.
 */
export async function buildLibraryClip(
  url: string
): Promise<{ article: Article; content: string }> {
  const clipped = await clipArticle(url);

  // Only pay for the metadata fetch when clipping left us without a title.
  const meta = clipped?.title ? { title: "", description: "" } : await fetchPageMeta(url);

  const title = (clipped?.title || meta.title || titleFromUrl(url)).slice(0, 300);
  const body = clipped ? stripMarkdown(clipped.content) : "";
  const sourceDomain = extractDomain(url);

  const description = clipped?.excerpt || meta.description;
  const preferred =
    description.length >= MIN_DESCRIPTION_LENGTH || !body ? description : body;

  const summary = truncate(preferred || body, SUMMARY_LIMIT) || `Saved from ${sourceDomain}`;

  const readingTime = clipped ? estimateReadingTime(clipped.content) : 0;

  // Namespaced rather than the bare URL `extractSourceId` would return, so a
  // clip and the pipeline's copy of the same article stay distinct rows under
  // the unique index on `source_id`. They cannot both exist — `source_url` is
  // unique too, and the route checks it first — but the identifier should not
  // be the thing that decides that.
  const sourceId = `library:${url}`;

  const article: Article = {
    slug: makeSlug(title, sourceId),
    title,
    sourceUrl: url,
    sourceDomain,
    summary,
    category: "Clipped",
    feed: LIBRARY_FEED,
    // The day it was saved, not the day it was published: the library is
    // ordered by when the reader kept something, and the page's own date is
    // not reliably available without a model call.
    date: archiveToday(),
    readingTime,
    clipped: clipped !== null,
    library: true,
    savedAt: new Date().toISOString(),
    // Both null for good: a clip is never scored (the score ranks the day's
    // news against the reader's interests, and the library is already the
    // reader's choice) and never joins a story group.
    relevanceScore: null,
    storyGroup: null,
    createdAt: new Date().toISOString(),
    sourceId,
    updatedAt: null,
    // Just clipped; nobody has opened it.
    read: false,
  };

  const content = clipped?.content ?? stubContent(url);

  return { article, content };
}
