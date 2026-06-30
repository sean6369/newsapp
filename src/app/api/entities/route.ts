import { NextRequest, NextResponse } from "next/server";
import { getAllEntities } from "@/lib/db/queries";
import type { EntityType, EntitySortMode } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const type = searchParams.get("type") as EntityType | null;
  const search = searchParams.get("search") || undefined;
  const sort = (searchParams.get("sort") as EntitySortMode) || "trending";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const result = await getAllEntities({
    type: type || undefined,
    search,
    sort,
    limit,
    offset,
  });

  return NextResponse.json(result);
}
