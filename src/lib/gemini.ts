export const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
export const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";

/**
 * Embedding model backing semantic retrieval. `gemini-embedding-2` over
 * `-001` for two measured reasons: it returns unit-norm vectors when the
 * output is truncated below the native 3072 (`-001` returns ~0.69, which
 * would need normalising client-side before any inner-product operator was
 * safe), and it accepts 8192 input tokens against `-001`'s 2048 — headroom
 * for embedding passages rather than just ledes.
 */
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";

/**
 * Truncated from the model's native 3072 via `outputDimensionality`. Baked
 * into the `articles.embedding` column type, so changing it means a migration
 * plus a full re-embed — see `embedding_model` for spotting stale rows.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export function geminiUrl(
  endpoint:
    | "generateContent"
    | "streamGenerateContent"
    | "embedContent"
    | "batchEmbedContents",
  model: string = GEMINI_MODEL
): string {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`;
  // Streaming is the one endpoint carrying a query param of its own. Callers
  // append `?key=...`, so that variant needs `&key=` instead — it has no
  // callers today, which is why the mismatch has never surfaced.
  return endpoint === "streamGenerateContent" ? `${base}?alt=sse` : base;
}
