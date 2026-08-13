import { db } from "../src/lib/db/index";
import {
  getUnembeddedArticles,
  getAllArticlesForEmbedding,
  updateArticleEmbedding,
} from "../src/lib/db/queries";
import { embedDocuments, embeddingInput } from "../src/lib/embeddings";

/**
 * Embeds the corpus for semantic retrieval.
 *
 * A script rather than the `/api/embed-backfill` route because the free tier
 * paces embedding by tokens per minute: the whole corpus is a run measured in
 * tens of minutes, which no HTTP request survives. The route stays the way to
 * top up the handful of articles a failed pipeline pass left behind.
 *
 * Safe to interrupt and re-run — vectors are stored as each chunk completes,
 * and the next run picks up whatever is still null.
 *
 *   npx tsx scripts/backfill-embeddings.ts          # only what's missing
 *   npx tsx scripts/backfill-embeddings.ts --force  # re-embed everything
 */

const force = process.argv.includes("--force");

/** Reported between chunks so a long run shows progress rather than hanging. */
const CHUNK = 100;

async function main() {
  const pending = force ? await getAllArticlesForEmbedding() : await getUnembeddedArticles();

  if (pending.length === 0) {
    console.log("[backfill-embeddings] Nothing to embed");
    return;
  }

  const totalChars = pending.reduce((sum, a) => sum + embeddingInput(a).length, 0);
  console.log(
    `[backfill-embeddings] ${pending.length} articles, ~${Math.round(totalChars / 4 / 1000)}k tokens${force ? " (force re-embed)" : ""}`
  );

  const startedAt = Date.now();
  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    const { vectors, quotaExhausted } = await embedDocuments(chunk.map(embeddingInput));

    for (const [j, vector] of vectors.entries()) {
      if (!vector) {
        failed++;
        continue;
      }
      try {
        await updateArticleEmbedding(chunk[j].slug, vector);
        embedded++;
      } catch (error) {
        failed++;
        console.error(`[backfill-embeddings] Failed to store: ${chunk[j].slug}`, error);
      }
    }

    const done = Math.min(i + CHUNK, pending.length);
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = embedded / elapsed;
    const eta = rate > 0 ? Math.round((pending.length - done) / rate / 60) : 0;
    console.log(
      `[backfill-embeddings] ${done}/${pending.length} — ${embedded} embedded, ${failed} failed, ~${eta}m left`
    );

    // The free tier allows 1,000 embeddings a day and counts every article,
    // batched or not. Stopping here is the difference between resuming
    // tomorrow and spending hours retrying a wall.
    if (quotaExhausted) {
      console.log(
        `[backfill-embeddings] Daily quota spent — ${pending.length - done} left. Re-run tomorrow.`
      );
      break;
    }
  }

  console.log(
    `[backfill-embeddings] Done in ${Math.round((Date.now() - startedAt) / 60000)}m: ${embedded} embedded, ${failed} failed`
  );

  if (failed > 0) {
    console.log("[backfill-embeddings] Re-run to retry the failures");
  }
}

main()
  .catch((error) => {
    console.error("[backfill-embeddings] Fatal:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
