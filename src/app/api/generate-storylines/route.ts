import { NextResponse } from "next/server";
import { generateAndStoreStorylines } from "@/lib/extractor";

export async function POST() {
  try {
    const result = await generateAndStoreStorylines();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generate-storylines] Failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
