import { cookies } from "next/headers";
import { SWRConfig } from "swr";
import { Feed } from "@/components/Feed";
import { FEED_VIEW_COOKIE, parseViewCookie } from "@/lib/view-cookie";
import { getFeedPayload, type FeedPayload } from "@/lib/feed-payload";
import { buildSwrKey, filtersFromParams } from "@/lib/feed-query";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  const initialView = parseViewCookie(cookieStore.get(FEED_VIEW_COOKIE)?.value, "grid");

  const filters = filtersFromParams(
    new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) => {
        const first = Array.isArray(v) ? v[0] : v;
        return first === undefined ? [] : [[k, first] as [string, string]];
      })
    )
  );
  // A search spans every day on record, so rendering it here would inline
  // thousands of articles into the document to save a request the reader made
  // deliberately and expects to wait for. Let the client fetch those; the cold
  // load of the feed itself is what this is for.
  if (filters.search) {
    return <Feed initialView={initialView} initialFilters={filters} />;
  }

  const payload = await getFeedPayload(filters);

  // Seed the one key the hook mounts with, and only that one.
  //
  // It is tempting to also seed the dated key the hook re-keys to a tick later,
  // which would make the cold load cost no requests at all. Don't: a seeded key
  // is never revalidated — `revalidateIfStale: false` suppresses the fetch on
  // arrival as well as on mount — so the newest day would serve this snapshot
  // for the rest of the session. That is the one day the crawler is still
  // appending to, and /api/fetch runs right after this HTML is generated, so
  // the reader would sit on a feed frozen at whatever had been filed when the
  // page was built while every other day answered live.
  //
  // What is left is stale-while-revalidate, which is what we actually want:
  // the first screen paints from this payload with no request, then the re-key
  // fetches the day for real, off the critical path and behind articles the
  // reader is already reading.
  const fallback: Record<string, FeedPayload> = { [buildSwrKey(filters)]: payload };

  // Everything this page needs is awaited above, in the page itself, and the
  // feed is handed the filters rather than reading the URL for them. That is
  // what keeps this render in one piece: a Suspense boundary here — which is
  // what wrapping useSearchParams used to require — would have React flush the
  // shell first and stream the feed in behind it, and a boundary with no
  // fallback shows nothing while it waits. The page painted blank and then
  // swapped a few hundred kilobytes of articles in at the end, which is a flash
  // that grows with the number of articles. Nothing suspends now, so the
  // browser is handed one settled document, in order, top to bottom.
  return (
    <SWRConfig value={{ fallback }}>
      <Feed initialView={initialView} initialFilters={filters} />
    </SWRConfig>
  );
}
