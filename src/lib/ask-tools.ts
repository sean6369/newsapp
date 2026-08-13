import { retrieveArticles, type RetrievedArticle } from "./retrieval";
import { getArticleBySlug, getArticleContent } from "./db/queries";
import type { FeedType } from "./types";

/**
 * The tools the AI reader can call against the archive.
 *
 * Declared non-strict deliberately. Strict mode would demand every optional
 * parameter be listed in `required` and typed as a union with null, which for
 * an enum like `feed` is a schema more awkward than the validation it
 * replaces. Arguments arrive as a JSON string and are parsed and clamped here
 * regardless, so strict mode would be a second lock on a door already bolted.
 */

const FEEDS: FeedType[] = ["tech", "ai", "singapore", "world", "asia", "finance"];

/**
 * Full article text is the largest thing that can enter the context window,
 * and the model asks for it once it has already decided an article matters —
 * so the cap is generous, but present.
 */
const MAX_ARTICLE_CHARS = 8_000;

export const askTools = [
  {
    type: "function",
    name: "search_articles",
    description:
      "Search the reader's own news archive. Returns matching articles with a short summary each. Use this before answering any question about the news — it is the only way to see what the reader has actually collected. Call it more than once with different wording if the first results are thin.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to search for. Natural language works; so do specific names and terms.",
        },
        feed: {
          type: "string",
          enum: FEEDS,
          description: "Restrict to one feed. Omit to search all of them.",
        },
        from: {
          type: "string",
          description: "Earliest publication date, inclusive, as YYYY-MM-DD.",
        },
        to: {
          type: "string",
          description: "Latest publication date, inclusive, as YYYY-MM-DD.",
        },
        limit: {
          type: "integer",
          description: "How many articles to return. Defaults to 12, maximum 30.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "get_article",
    description:
      "Read the full text of one article from the archive, by the slug returned from search_articles. Use it when a summary is not enough to answer accurately, or when quoting.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The article's slug, exactly as given by search_articles.",
        },
      },
      required: ["slug"],
    },
  },
] as const;

export interface ToolExecution {
  /** Serialised for the model. */
  output: string;
  /** Surfaced to the UI so a search can render as a step and its hits as cards. */
  articles?: RetrievedArticle[];
  /** Short human-readable description of what the call did. */
  detail: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `YYYY-MM-DD`, matching how `articles.date` is stored and compared. */
function asDate(value: unknown): string | undefined {
  const s = asString(value);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function asFeed(value: unknown): FeedType | undefined {
  const s = asString(value);
  return s && (FEEDS as string[]).includes(s) ? (s as FeedType) : undefined;
}

async function runSearch(args: Record<string, unknown>): Promise<ToolExecution> {
  const query = asString(args.query);
  if (!query) {
    return { output: "Error: query is required.", detail: "search with no query" };
  }

  const limitRaw = typeof args.limit === "number" ? args.limit : undefined;

  const articles = await retrieveArticles({
    query,
    feed: asFeed(args.feed),
    from: asDate(args.from),
    to: asDate(args.to),
    limit: limitRaw,
  });

  if (articles.length === 0) {
    return {
      output: `No articles found for "${query}".`,
      articles: [],
      detail: `“${query}” — nothing found`,
    };
  }

  // Rendered as text rather than JSON: the model reads this, and prose costs
  // fewer tokens than the punctuation and repeated keys of a JSON array.
  const output = articles
    .map((a) => {
      const also = a.alsoReportedBy.length
        ? ` [also reported by ${a.alsoReportedBy.join(", ")}]`
        : "";
      return `slug: ${a.slug}\n${a.title}\n${a.date} · ${a.sourceDomain} · ${a.feed}${also}\n${a.summary}`;
    })
    .join("\n\n");

  return {
    output: `${articles.length} article(s) for "${query}":\n\n${output}`,
    articles,
    detail: `“${query}” — ${articles.length} article${articles.length === 1 ? "" : "s"}`,
  };
}

async function runGetArticle(args: Record<string, unknown>): Promise<ToolExecution> {
  const slug = asString(args.slug);
  if (!slug) {
    return { output: "Error: slug is required.", detail: "get_article with no slug" };
  }

  const article = await getArticleBySlug(slug);
  if (!article) {
    return {
      output: `No article with slug "${slug}". Use a slug returned by search_articles.`,
      detail: `${slug} — not found`,
    };
  }

  const content = (await getArticleContent(slug)) ?? article.summary;
  const truncated = content.length > MAX_ARTICLE_CHARS;

  return {
    output: [
      `Title: ${article.title}`,
      `Source: ${article.sourceUrl} (${article.sourceDomain})`,
      `Published: ${article.date}`,
      "",
      content.slice(0, MAX_ARTICLE_CHARS),
      truncated ? "\n[truncated]" : "",
    ].join("\n"),
    detail: article.title,
  };
}

/**
 * Runs one tool call. Never throws: a tool that fails should hand the model a
 * message it can read and work around, since an exception here would abort a
 * reply that is already half-streamed to the reader.
 */
export async function executeAskTool(
  name: string,
  rawArguments: string
): Promise<ToolExecution> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { output: "Error: arguments were not valid JSON.", detail: "bad arguments" };
  }

  try {
    if (name === "search_articles") return await runSearch(args);
    if (name === "get_article") return await runGetArticle(args);
    return { output: `Error: unknown tool "${name}".`, detail: `unknown tool ${name}` };
  } catch (error) {
    console.error(`[ask] Tool ${name} failed:`, error);
    return {
      output: `Error running ${name}. Try different search terms, or answer from what you already have.`,
      detail: `${name} failed`,
    };
  }
}
