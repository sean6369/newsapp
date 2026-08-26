import { NextRequest, NextResponse } from "next/server";
import { getFeedPayload } from "@/lib/feed-payload";
import { filtersFromParams } from "@/lib/feed-query";

export async function GET(request: NextRequest) {
  // The page's own parser rather than a second copy of the defaults. The feed
  // page seeds SWR's cache under a key built from these filters and the hook
  // then fetches this route with that same key, so the two spellings have to
  // agree — they had drifted already, `sort` defaulting to "relevance" there
  // and "date-desc" here. Sharing the parser also gains the date validation,
  // so a hand-edited `?date=` falls back to the newest day instead of querying
  // for a day that cannot exist.
  return NextResponse.json(
    await getFeedPayload(filtersFromParams(request.nextUrl.searchParams))
  );
}
