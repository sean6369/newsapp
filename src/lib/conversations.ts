import { OPENAI_API_KEY, OPENAI_CHAT_MODEL, OPENAI_URL } from "./openai";
import { MAX_TITLE_LENGTH, fallbackTitle } from "./conversation-title";
import type { AskStep, ChatMessage, RetrievedArticle, SearchSource } from "./types";

/**
 * What a stored conversation is allowed to be.
 *
 * `conversations.messages` is a `jsonb` column written straight from a request
 * body, which makes this the boundary: without it the endpoint is an arbitrary
 * JSON store that happens to be reachable from the Ask page. The caps are not
 * about a hostile client — this app has one reader — but about the failure
 * that is actually plausible, a loop on the page sending a thread that grows
 * without limit until a single row is megabytes of retrieval history.
 *
 * Fields are copied across one at a time rather than spread, so anything the
 * client invents is dropped instead of being persisted forever in a column
 * nothing validates on the way out.
 */
const MAX_MESSAGES = 400;
/** Generous: an answer quoting several articles runs long, and truncating one
 *  mid-sentence on save would corrupt a thread the reader can still see. */
const MAX_CONTENT_LENGTH = 120_000;
const MAX_STEPS = 40;
const MAX_ARTICLES = 80;
const MAX_SOURCES = 40;

/**
 * How much of the opening exchange the titler is shown.
 *
 * The answer's allowance is the one that was measured, and measured against
 * real answers rather than invented ones — an invented fixture gave the wrong
 * reading twice before real ones settled it.
 *
 * Real answers run from about 3,000 characters to 17,500, and it is the broad
 * questions most in need of a written title that produce the longest. An
 * earlier 1,000 therefore saw little beyond the opening sentence. 4,000 is
 * where it stops mattering: titles written from 4,000 characters, from 12,000,
 * and from a whole 17,500-character week all agree, because an Ask answer
 * opens with a paragraph summarising itself before going into detail. Reading
 * past that costs three times the input tokens and changes nothing, and
 * sampling the tail as well — tried, on the same real answer — changes nothing
 * either.
 *
 * Both are ceilings on one exchange, not on the thread. Only the first
 * question and first answer are ever sent, which is the part that keeps a
 * title describing what a chat is about rather than drifting towards whatever
 * it wandered into last — truncating *within* that exchange bought nothing and
 * cost accuracy.
 */
const TITLE_QUESTION_CHARS = 2_000;
const TITLE_ANSWER_CHARS = 4_000;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function sanitiseSteps(input: unknown): AskStep[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const steps = input.slice(0, MAX_STEPS).flatMap((step): AskStep[] => {
    if (!step || typeof step !== "object") return [];
    const { tool, detail } = step as Record<string, unknown>;
    if (tool !== "search_articles" && tool !== "get_article") return [];
    return [{ tool, detail: str(detail, 500) }];
  });

  return steps.length > 0 ? steps : undefined;
}

function sanitiseArticles(input: unknown): RetrievedArticle[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const articles = input.slice(0, MAX_ARTICLES).flatMap((article): RetrievedArticle[] => {
    if (!article || typeof article !== "object") return [];
    const a = article as Record<string, unknown>;
    if (typeof a.slug !== "string") return [];

    return [
      {
        slug: a.slug.slice(0, 300),
        title: str(a.title, 500),
        summary: str(a.summary, 4_000),
        date: str(a.date, 10),
        sourceDomain: str(a.sourceDomain, 300),
        feed: str(a.feed, 50),
        alsoReportedBy: Array.isArray(a.alsoReportedBy)
          ? a.alsoReportedBy.slice(0, 20).map((outlet) => str(outlet, 300))
          : [],
      },
    ];
  });

  return articles.length > 0 ? articles : undefined;
}

function sanitiseSources(input: unknown): SearchSource[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const sources = input.slice(0, MAX_SOURCES).flatMap((source): SearchSource[] => {
    if (!source || typeof source !== "object") return [];
    const { title, url } = source as Record<string, unknown>;
    if (typeof url !== "string") return [];
    return [{ title: str(title, 500) || url.slice(0, 2_000), url: url.slice(0, 2_000) }];
  });

  return sources.length > 0 ? sources : undefined;
}

/**
 * Reduce a posted thread to the shape the column is declared to hold.
 *
 * Returns null for anything that is not a usable conversation, which the route
 * turns into a 400. A thread whose *individual messages* are malformed is
 * pruned rather than rejected: the reader can see the conversation on their
 * screen, and refusing to store it because one message lost a field would lose
 * them the whole chat.
 */
export function sanitiseMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const messages = input.slice(0, MAX_MESSAGES).flatMap((message): ChatMessage[] => {
    if (!message || typeof message !== "object") return [];
    const m = message as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant") return [];
    if (typeof m.id !== "string") return [];

    const sources = sanitiseSources(m.sources);
    const steps = sanitiseSteps(m.steps);
    const articles = sanitiseArticles(m.articles);

    return [
      {
        id: m.id.slice(0, 200),
        role: m.role,
        content: str(m.content, MAX_CONTENT_LENGTH),
        // Spread conditionally so an absent field stays absent in the column
        // rather than being stored as an explicit null the client would then
        // have to treat as "no articles" on the way back out.
        ...(sources ? { sources } : {}),
        ...(steps ? { steps } : {}),
        ...(articles ? { articles } : {}),
      },
    ];
  });

  return messages.length > 0 ? messages : null;
}

/**
 * Trim a model's title down to something a list row can hold.
 *
 * The model is asked for a bare phrase and mostly obliges, but the failures
 * are consistent enough to be worth undoing here rather than re-prompting:
 * wrapping quotes, a "Title:" preamble, a trailing full stop, and — when it
 * decides the instruction was a conversation — several lines where one was
 * asked for. Only the first line survives.
 */
function tidyTitle(raw: string): string {
  const firstLine = raw.trim().split("\n")[0] ?? "";

  const cleaned = firstLine
    .replace(/^\s*(?:title|chat|conversation)\s*[:—-]\s*/i, "")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();

  return cleaned.slice(0, MAX_TITLE_LENGTH);
}


/** An output item from the Responses API, as far as reading one answer needs. */
interface OutputItem {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * The assistant's prose out of a non-streaming Responses reply.
 *
 * `output` is a list, not a message: a reasoning model puts a `reasoning` item
 * in front of its answer, and the `output_text` convenience property that would
 * skip past all this belongs to the SDK rather than the HTTP response. So the
 * message items are picked out and their text parts joined.
 *
 * Returns "" for a reply that carries no text at all — a response cut short by
 * the token cap reports `status: "incomplete"` and an output holding nothing
 * but reasoning, which is indistinguishable here from any other failure and is
 * treated the same way: the caller falls back.
 */
function readOutputText(output: unknown): string {
  if (!Array.isArray(output)) return "";

  return (output as OutputItem[])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/**
 * Name a conversation from its opening exchange.
 *
 * The same OpenAI model that answered the question, deliberately. An earlier
 * version sent this to Gemini flash-lite on the grounds that a reasoning model
 * is an absurd instrument for writing four words — but what makes it absurd is
 * the reasoning effort, which is a parameter, and `low` settles it. Against
 * that saving stood a real cost: flash-lite's free tier allows 15 requests a
 * minute per model and the relevance scorer already paces itself to 14 of
 * them, so titles would have been contending for a bucket the hourly pipeline
 * empties, and losing that race means a chat is named by its fallback forever.
 * One provider for the whole Ask feature, on the key that has no such cliff.
 *
 * Only the first exchange is sent, and the answer only in part. A title
 * describes what the chat is *about*, which the opening question settles;
 * feeding it the whole thread would cost tokens to make the title drift
 * towards whatever the conversation wandered into last.
 *
 * Never throws. A chat that cannot be named is still a chat worth keeping, so
 * every failure — no key, an API error, a timeout, an empty completion —
 * returns {@link fallbackTitle} and the save proceeds.
 */
export async function generateConversationTitle(messages: ChatMessage[]): Promise<string> {
  const fallback = fallbackTitle(messages);

  if (!OPENAI_API_KEY) return fallback;

  const question = messages.find((m) => m.role === "user")?.content.trim() ?? "";
  const answer = messages.find((m) => m.role === "assistant")?.content.trim() ?? "";
  if (!question) return fallback;

  const prompt = `Write a short title for this conversation from a personal news-reading app.

Rules:
- 2 to 6 words. Never more than ${MAX_TITLE_LENGTH} characters.
- Name the subject, not the act of asking. "Singapore housing policy", not "Question about housing".
- Sentence case. No quotation marks, no trailing punctuation, no emoji.
- Prefer the question's own wording, but name what the exchange was actually about. A question like "What happened today?" is not a usable title on its own; the answer is what tells one such chat from another.
- If the answer ranged over several unrelated stories, name the two or three areas it covered — "Tech, housing and rates". Never a generic label like "news roundup" or "daily update": those read the same on every chat, which is the one thing a title in a list must not do.
- Do not invent specifics the conversation does not contain.
- Respond with the title alone and nothing else.

Question: ${question.slice(0, TITLE_QUESTION_CHARS)}
${answer ? `Answer: ${answer.slice(0, TITLE_ANSWER_CHARS)}` : ""}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        input: [{ role: "user", content: prompt }],
        // `low`, not `minimal`. Naming a conversation needs no deliberation, but
        // an effort level the model rejects is a 400 — and a 400 here is silent,
        // permanent, and identical in appearance to working correctly, because
        // every chat would simply be named by its fallback. `low` is accepted
        // across the whole reasoning family; the saving from `minimal` is not
        // worth finding out the hard way.
        reasoning: { effort: "low" },
        // Reasoning tokens are drawn from this budget too, so it is set well
        // above what a title needs. Too tight a cap does not truncate the
        // title — it spends the whole allowance thinking and returns an
        // `incomplete` response with no text in it at all.
        max_output_tokens: 2_000,
      }),
      // Nothing is waiting on this — the answer finished streaming before the
      // save began — but the request holding it open is, and a title is not
      // worth a hung handler.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      console.warn(`[conversations] Title generation failed: ${response.status}`);
      return fallback;
    }

    const data = await response.json();
    const title = tidyTitle(readOutputText(data.output));

    return title.length >= 3 ? title : fallback;
  } catch (error) {
    console.warn("[conversations] Title generation error:", error);
    return fallback;
  }
}

export { fallbackTitle };
