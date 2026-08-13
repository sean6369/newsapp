import { NextRequest, NextResponse, after } from "next/server";
import { getOrStartFetchPipeline } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_PIPELINE === "false") {
    return NextResponse.json({ message: "Pipeline disabled" });
  }

  const body = await request.json().catch(() => ({}));

  try {
    // Joins a run already in flight rather than starting a second one — a page
    // refresh remounts the feed and fires this route again.
    const { result, finalize } = await getOrStartFetchPipeline({ date: body.date });
    // Run scoring + extraction after the response is sent so the request stays
    // under Cloudflare's ~100s limit and the feed's auto-refresh still fires.
    // Safe to call on a joined run: `finalize` memoises, so it executes once.
    after(finalize);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/fetch] Pipeline error:", error);
    return NextResponse.json(
      { error: "Pipeline failed" },
      { status: 500 }
    );
  }
}
