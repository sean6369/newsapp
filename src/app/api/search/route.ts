import { NextRequest, NextResponse } from "next/server";
import { searchArticles } from "@/lib/db/queries";
import type { FeedType, SearchSortMode } from "@/lib/types";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;

/** Postgres rejects a negative LIMIT/OFFSET outright, so clamp before querying. */
function positiveInt(raw: string | null, fallback: number, max?: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return max === undefined ? parsed : Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const query = searchParams.get("q") || "";
  const feed = searchParams.get("feed") as FeedType | "all" | null;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const sort = (searchParams.get("sort") as SearchSortMode) || "relevance";
  const limit = positiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = positiveInt(searchParams.get("offset"), 0);

  const result = await searchArticles({
    query,
    feed: feed || undefined,
    from,
    to,
    sort,
    limit,
    offset,
  });

  return NextResponse.json(result);
}
