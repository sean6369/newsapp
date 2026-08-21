import { NextRequest, NextResponse } from "next/server";
import { getFeedSourceOverrides, setFeedSourceOverrides } from "@/lib/db/queries";
import { isKnownSourceId, resolveFeedSources } from "@/lib/feed-sources";

/** The current roster, with the reader's switches applied. */
export async function GET() {
  const sources = resolveFeedSources(await getFeedSourceOverrides());
  return NextResponse.json({ sources });
}

/**
 * Switch sources on or off.
 *
 * A patch (`{ "cna-world": false }`), not the full roster. The settings page
 * changes one feed's group at a time, and sending everything on every click
 * would let a stale tab silently revert switches thrown somewhere else.
 *
 * Unknown ids are refused rather than stored: a typo would otherwise sit in
 * the table forever, matching nothing and explaining nothing.
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const updates: unknown = body?.updates;

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return NextResponse.json(
      { error: "updates must be an object of source id → enabled" },
      { status: 400 }
    );
  }

  const entries = Object.entries(updates as Record<string, unknown>);

  const unknown = entries.map(([id]) => id).filter((id) => !isKnownSourceId(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown source: ${unknown.join(", ")}` },
      { status: 400 }
    );
  }

  if (entries.some(([, enabled]) => typeof enabled !== "boolean")) {
    return NextResponse.json(
      { error: "Every value must be true or false" },
      { status: 400 }
    );
  }

  await setFeedSourceOverrides(Object.fromEntries(entries) as Record<string, boolean>);

  const sources = resolveFeedSources(await getFeedSourceOverrides());
  const off = sources.filter((s) => !s.enabled).map((s) => s.id);
  console.log(
    `[settings] Sources updated; ${off.length ? `off: ${off.join(", ")}` : "all on"}`
  );

  return NextResponse.json({ sources });
}
