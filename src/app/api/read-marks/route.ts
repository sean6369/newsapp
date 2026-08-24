import { NextRequest, NextResponse } from "next/server";
import { clearReadMarks, setReadMark, setSetting } from "@/lib/db/queries";
import { READ_MARKS_SETTING, readMarksSettingValue } from "@/lib/read-marks";
import { getReadMarksEnabled } from "@/lib/read-marks-server";

/**
 * Writes only.
 *
 * There is deliberately no GET: read state is carried by the articles
 * themselves, so nothing ever needs to ask for the marks as a set. An endpoint
 * that answered "all of them" would be a standing invitation to fetch a
 * payload that grows with everything the reader has ever opened.
 */

/**
 * Mark one article read or unread.
 *
 * One slug per request, not a set. The client sends these one click at a time
 * and reverts the one that failed; a batch would make a partial failure mean
 * reverting marks that had actually been stored.
 *
 * A write while the feature is off is refused rather than quietly dropped —
 * it can only mean a tab that was left open before the switch was thrown, and
 * that tab should hear about it rather than go on dimming cards nothing will
 * remember.
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const slug: unknown = body?.slug;
  const read: unknown = body?.read;

  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json({ error: "slug must be a non-empty string" }, { status: 400 });
  }
  if (typeof read !== "boolean") {
    return NextResponse.json({ error: "read must be true or false" }, { status: 400 });
  }

  // Just the setting: this runs on every card click, and it is a primary-key
  // lookup on a table holding one row.
  if (!(await getReadMarksEnabled())) {
    return NextResponse.json(
      { error: "Read marks are switched off in settings" },
      { status: 409 }
    );
  }

  try {
    await setReadMark(slug, read);
  } catch (err) {
    // The foreign key is the check that the slug names a real article, so a
    // violation here is a stale card rather than a server fault — most likely
    // one whose article was deleted in another tab.
    console.error("[read-marks] write failed:", err);
    return NextResponse.json({ error: "That article is no longer in the archive" }, { status: 404 });
  }

  return NextResponse.json({ slug, read });
}

/**
 * Switch the feature on or off.
 *
 * Switching off clears the table in the same request. That is the behaviour
 * the settings page promises in as many words, and doing it here rather than
 * asking the client to follow up with a delete means it cannot half-happen.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const enabled: unknown = body?.enabled;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }

  await setSetting(READ_MARKS_SETTING, readMarksSettingValue(enabled));
  if (!enabled) await clearReadMarks();

  console.log(`[read-marks] ${enabled ? "on" : "off — every mark cleared"}`);
  return NextResponse.json({ enabled });
}
