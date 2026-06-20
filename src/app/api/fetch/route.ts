import { NextRequest, NextResponse } from "next/server";
import { runFetchPipeline } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_PIPELINE === "false") {
    return NextResponse.json({ message: "Pipeline disabled" });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runFetchPipeline({ date: body.date });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/fetch] Pipeline error:", error);
    return NextResponse.json(
      { error: "Pipeline failed" },
      { status: 500 }
    );
  }
}
