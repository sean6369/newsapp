import { NextResponse } from "next/server";
import { listConversations } from "@/lib/db/queries";

/**
 * Every past Ask conversation, titles only.
 *
 * Read when the history drawer opens rather than when the Ask page loads —
 * see `useConversations` — so a reader who never opens it never pays for it.
 */
export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}
