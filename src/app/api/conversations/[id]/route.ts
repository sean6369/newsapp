import { NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  getConversationTitle,
  saveConversation,
} from "@/lib/db/queries";
import { generateConversationTitle, sanitiseMessages } from "@/lib/conversations";

/** `params` is a promise in this version of Next; see `docs/.../route.md`. */
type Context = { params: Promise<{ id: string }> };

/**
 * A conversation id is a UUID the browser minted, so anything that is not one
 * is a bug or a hand-typed URL rather than a chat that has gone missing.
 * Checked because the id reaches a primary key and a 400 says more than an
 * empty 404 would.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One conversation with its whole thread, for reopening it on the Ask page. */
export async function GET(_request: NextRequest, { params }: Context) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Not a conversation id" }, { status: 400 });
  }

  const conversation = await getConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

/**
 * Store a conversation, creating it if this is its first save.
 *
 * Upsert rather than a POST-then-PUT pair because the client owns the id: it
 * mints a UUID when the first answer lands and sends the whole thread after
 * every exchange, so there is no moment where it knows whether the row exists
 * and no round trip in which to find out. One idempotent verb makes a retried
 * save harmless.
 *
 * Naming happens here, once, and only for a row that does not exist yet. It
 * costs an extra model call on the request that creates the chat — which is
 * why it is worth being clear about what that request is *not* holding up:
 * the answer has already finished streaming and is on screen, and the reader
 * is not waiting on anything this returns.
 */
export async function PUT(request: NextRequest, { params }: Context) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Not a conversation id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const messages = sanitiseMessages(body?.messages);

  if (!messages) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const existingTitle = await getConversationTitle(id);
  const title = existingTitle ?? (await generateConversationTitle(messages));

  const conversation = await saveConversation({ id, title, messages });

  if (!existingTitle) {
    console.log(`[conversations] Started "${conversation.title}"`);
  }

  return NextResponse.json({ conversation });
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Not a conversation id" }, { status: 400 });
  }

  const deleted = await deleteConversation(id);
  if (!deleted) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({ id });
}
