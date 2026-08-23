import { Suspense } from "react";
import { cookies } from "next/headers";
import { SWRConfig } from "swr";
import { Feed } from "@/components/Feed";
import { FEED_VIEW_COOKIE, parseViewCookie } from "@/lib/view-cookie";
import { getFeedPayload, type FeedPayload } from "@/lib/feed-payload";
import { buildSwrKey, filtersFromParams } from "@/lib/feed-query";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function FeedWithView({ searchParams }: { searchParams: SearchParams }) {
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
    return <Feed initialView={initialView} />;
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

  return (
    <SWRConfig value={{ fallback }}>
      <Feed initialView={initialView} />
    </SWRConfig>
  );
}

export default function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense>
      <FeedWithView searchParams={searchParams} />
    </Suspense>
  );
}
