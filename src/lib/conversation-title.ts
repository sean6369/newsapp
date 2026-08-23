import type { ChatMessage } from "./types";

/**
 * Naming a conversation without a model, and the ceiling every title obeys.
 *
 * Split out from `lib/conversations` so the browser can import it. That module
 * reaches for `lib/openai` and an API key, which is fine on a route handler and
 * wrong in a bundle — but the history drawer needs this exact rule to label a
 * conversation that has not been saved yet, and a second copy of a truncation
 * rule is a copy that drifts. One definition, both sides.
 */

/** Long enough for any real title; short enough that the drawer stays a list. */
export const MAX_TITLE_LENGTH = 60;

/**
 * The question that started the chat, as its own title.
 *
 * Not merely the error path. This is what the list shows whenever the model is
 * unavailable, out of quota, or slow enough to have been given up on, and it
 * is always *true* — a chat named by what the reader actually typed is never
 * wrong about itself, only longer than a written title would be. That is why
 * nothing retries a failed generation: the fallback is good enough to live
 * with permanently, and a title that changed on a later save would move a row
 * the reader had already learned to find.
 */
export function fallbackTitle(messages: ChatMessage[]): string {
  const opening = messages.find((m) => m.role === "user")?.content.trim();
  if (!opening) return "New chat";

  const oneLine = opening.replace(/\s+/g, " ");
  if (oneLine.length <= MAX_TITLE_LENGTH) return oneLine;

  // Break at a word rather than mid-syllable, but only if that leaves most of
  // the allowance — a question whose first word is very long would otherwise
  // be cut back to almost nothing.
  const clipped = oneLine.slice(0, MAX_TITLE_LENGTH - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const stem = lastSpace > MAX_TITLE_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  return `${stem}…`;
}
