import { NextRequest, NextResponse } from "next/server";
import {
  getUnembeddedArticles,
  getAllArticlesForEmbedding,
  updateArticleEmbedding,
} from "@/lib/db/queries";
import { embedDocuments, embeddingInput } from "@/lib/embeddings";

/**
 * How many articles one call will embed.
 *
 * Sized against the free tier's token-per-minute pacing rather than anything
 * about the database: ~550 tokens per article puts 50 articles at roughly one
 * minute of budget, which is about all that fits under the Cloudflare tunnel's
 * request limit. This route is for topping up the few articles a failed
 * pipeline pass left behind — the whole-corpus run belongs in
 * `scripts/backfill-embeddings.ts`, which has no such ceiling.
 */
const MAX_PER_RUN = 50;

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_PIPELINE === "false") {
    return NextResponse.json({ message: "Pipeline disabled" });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";
  const pending = force ? await getAllArticlesForEmbedding() : await getUnembeddedArticles();
  const remaining = Math.max(pending.length - MAX_PER_RUN, 0);
  const toEmbed = pending.slice(0, MAX_PER_RUN);

  if (toEmbed.length === 0) {
    return NextResponse.json({ message: "No articles to embed", embedded: 0, remaining: 0 });
  }

  console.log(
    `[embed-backfill] Embedding ${toEmbed.length} articles${force ? " (force re-embed)" : ""}, ${remaining} to follow...`
  );

  const { vectors, quotaExhausted } = await embedDocuments(toEmbed.map(embeddingInput));

  let embedded = 0;
  let failed = 0;

  for (const [i, vector] of vectors.entries()) {
    if (!vector) {
      failed++;
      continue;
    }
    try {
      await updateArticleEmbedding(toEmbed[i].slug, vector);
      embedded++;
    } catch (error) {
      failed++;
      console.error(`[embed-backfill] Failed to store: ${toEmbed[i].slug}`, error);
    }
  }

  console.log(
    `[embed-backfill] Done: ${embedded} embedded, ${failed} failed${quotaExhausted ? " (daily quota spent)" : ""}`
  );

  return NextResponse.json({
    total: toEmbed.length,
    embedded,
    failed,
    // Surfaced so a caller looping this route stops for the day rather than
    // hammering a quota that will reject everything until it resets.
    quotaExhausted,
    // Failures stay null and reappear in the next call's pending set, so this
    // counts them as still outstanding rather than as progress.
    remaining: remaining + failed,
  });
}
