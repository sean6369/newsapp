import { format } from "date-fns";
import { fetchDigestUrls, scrapeDigestPage, fetchCNAArticles, fetchSTArticles } from "./feeds";
import {
  CNA_WORLD_FEED_URL,
  CNA_ASIA_FEED_URL,
  CNA_FINANCE_FEED_URL,
  ST_WORLD_FEED_URL,
  ST_ASIA_FEED_URL,
  ST_BUSINESS_FEED_URL,
} from "./types";
import { clipArticle } from "./clipper";
import { buildArticle } from "./articles";
import {
  insertArticle,
  getExistingArticles,
  updateArticleMetadata,
  matchStories,
  updateRelevanceScore,
  updateArticleEmbedding,
  getArticlesForEmbeddingBySlugs,
} from "./db/queries";
import { scoreArticle } from "./scorer";
import { embedDocuments, embeddingInput } from "./embeddings";
import type { RawArticle, PipelineResult } from "./types";

const MAX_CONCURRENT = 3;
const DELAY_BETWEEN_BATCHES_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    if (i + batchSize < items.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return results;
}

/**
 * Runs the fetch pipeline in two phases:
 *
 * - **Phase 1 (awaited here):** fetch sources, dedup, clip + insert, and match
 *   stories — everything needed for new articles to appear in the feed. The
 *   returned `result` is complete once this resolves.
 * - **Phase 2 (`finalize`):** relevance scoring (rate-limited). Returned as a
 *   continuation so the HTTP route can defer it past the response via `after()`
 *   (keeping the request under Cloudflare's ~100s limit so the feed's
 *   auto-refresh still fires), while the scheduler awaits it inline.
 */
export async function runFetchPipeline(options?: {
  date?: string;
}): Promise<{ result: PipelineResult; finalize: () => Promise<void> }> {
  const targetDate = options?.date || format(new Date(), "yyyy-MM-dd");
  console.log(`[pipeline] Starting fetch for ${targetDate}`);

  // 1. Fetch all sources in parallel (TLDR scrapes + CNA/ST RSS)
  const digests = fetchDigestUrls(targetDate);
  const [tldrResults, cnaSG, cnaWorld, cnaAsia, cnaFinance, stSG, stWorld, stAsia, stFinance] = await Promise.all([
    Promise.all(digests.map((d) => scrapeDigestPage(d.url, d.feed, d.date))),
    fetchCNAArticles(),
    fetchCNAArticles(CNA_WORLD_FEED_URL, "world"),
    fetchCNAArticles(CNA_ASIA_FEED_URL, "asia"),
    fetchCNAArticles(CNA_FINANCE_FEED_URL, "finance"),
    fetchSTArticles(),
    fetchSTArticles(ST_WORLD_FEED_URL, "world"),
    fetchSTArticles(ST_ASIA_FEED_URL, "asia"),
    fetchSTArticles(ST_BUSINESS_FEED_URL, "finance"),
  ]);
  const allArticles: RawArticle[] = [
    ...tldrResults.flat(),
    ...cnaSG, ...cnaWorld, ...cnaAsia, ...cnaFinance,
    ...stSG, ...stWorld, ...stAsia, ...stFinance,
  ];
  console.log(
    `[pipeline] TLDR: ${tldrResults.flat().length} | CNA: ${cnaSG.length} SG, ${cnaWorld.length} world, ${cnaAsia.length} asia, ${cnaFinance.length} finance | ST: ${stSG.length} SG, ${stWorld.length} world, ${stAsia.length} asia, ${stFinance.length} finance`
  );

  // 2. Deduplicate within batch and against database
  const seen = new Set<string>();
  const unique = allArticles.filter((a) => {
    if (seen.has(a.sourceId)) return false;
    seen.add(a.sourceId);
    return true;
  });

  const { bySourceId, bySourceUrl } = await getExistingArticles(
    unique.map((a) => a.sourceId),
    unique.map((a) => a.sourceUrl)
  );

  console.log(
    `[pipeline] ${unique.length} unique articles (${allArticles.length - unique.length} duplicates, ${bySourceId.size + bySourceUrl.size} skipped)`
  );

  const newArticles: RawArticle[] = [];
  // Days whose grouping this run could have invalidated — see `matchStories`.
  // A retitled article contributes its *stored* date, which is not necessarily
  // `targetDate`: TLDR re-checks yesterday's digest on every run, so a run can
  // touch a day other than the one it set out to fetch.
  const affectedDates = new Set<string>();
  let metadataUpdates = 0;
  for (const a of unique) {
    const existing = bySourceId.get(a.sourceId) ?? bySourceUrl.get(a.sourceUrl);

    if (existing) {
      const titleChanged = existing.title !== a.title;
      const urlChanged = existing.sourceUrl !== a.sourceUrl;

      if (titleChanged || urlChanged) {
        // Build metadata updates — slug stays unchanged
        const updates: { title?: string; sourceUrl?: string; content?: string } = {};
        if (titleChanged) updates.title = a.title;
        if (urlChanged) updates.sourceUrl = a.sourceUrl;

        // Re-clip from the current URL
        const reclipped = await clipArticle(a.sourceUrl);
        if (reclipped) updates.content = reclipped.content;

        try {
          await updateArticleMetadata(existing.slug, updates);
          metadataUpdates++;

          if (titleChanged) {
            // Only a title change can alter matching; a new URL cannot.
            affectedDates.add(existing.date);
            console.log(`[pipeline] Title updated: "${existing.title}" → "${a.title}" (slug unchanged: ${existing.slug})`);
          }
          if (urlChanged) {
            console.log(`[pipeline] URL updated: ${existing.sourceUrl} → ${a.sourceUrl}`);
          }
        } catch (err: unknown) {
          // Skip duplicate source_url conflicts (same article in multiple feeds)
          const pgCode = (err as { cause?: { code?: string } })?.cause?.code;
          if (pgCode === "23505") {
            console.log(`[pipeline] Skipped update for "${a.title}" (duplicate source_url)`);
          } else {
            throw err;
          }
        }
      }
    } else {
      newArticles.push(a);
    }
  }

  if (metadataUpdates > 0) {
    console.log(`[pipeline] Updated metadata for ${metadataUpdates} article(s)`);
  }

  const result: PipelineResult = {
    date: targetDate,
    totalFound: unique.length,
    newArticles: newArticles.length,
    clipped: 0,
    failedClips: 0,
    skippedExisting: unique.length - newArticles.length,
  };

  // 3. Clip and insert to database. Scoring is deferred to phase 2 so articles
  //    appear in the app immediately instead of waiting on rate-limited Gemini calls.
  let scoreTargets: { slug: string; date: string; raw: RawArticle }[] = [];
  if (newArticles.length > 0) {
    console.log(`[pipeline] Processing ${newArticles.length} new articles...`);

    const inserted = await processInBatches(newArticles, MAX_CONCURRENT, async (rawArticle) => {
      const clipped = await clipArticle(rawArticle.sourceUrl);

      if (clipped) {
        result.clipped++;
      } else {
        result.failedClips++;
      }

      const { article, content } = buildArticle(rawArticle, clipped?.content || null);
      const insertedOk = await insertArticle(article, content);

      if (!insertedOk) {
        console.log(`[pipeline] Duplicate slug "${article.slug}"`);
        return null;
      }
      return { slug: article.slug, date: article.date, raw: rawArticle };
    });

    scoreTargets = inserted.filter(
      (t): t is { slug: string; date: string; raw: RawArticle } => t !== null
    );
    for (const t of scoreTargets) affectedDates.add(t.date);
  } else {
    console.log("[pipeline] No new articles to process");
  }

  // 4. Match stories across sources (CNA ↔ ST). Kept in phase 1 so grouping is
  //    done before the response and is visible as soon as new articles slide
  //    in. It hits no external API, and is scoped to the days this run actually
  //    touched — a run that found nothing new does no work here at all, which
  //    is the common case for the hourly cron and for a feed remount. Cost
  //    still grows with (articles per day)² on a day that does gain articles.
  await matchStories([...affectedDates]);

  // Phase 2: relevance scoring. Deferred so the caller can
  // run it after sending the response (HTTP route) or inline (scheduler).
  const runFinalize = async () => {
    // Score inserted articles in a throttled pass. scoreArticle self-limits to
    // the Gemini free-tier quota (15 req/min); failures leave relevance_score
    // null (set at insert) for the next backfill run to retry.
    if (scoreTargets.length > 0) {
      console.log(`[pipeline] Scoring ${scoreTargets.length} articles...`);
      let scored = 0;
      await processInBatches(scoreTargets, MAX_CONCURRENT, async ({ slug, raw }) => {
        const score = await scoreArticle(raw);
        if (score !== null) {
          await updateRelevanceScore(slug, score);
          scored++;
        }
      });
      console.log(`[pipeline] Scored ${scored}/${scoreTargets.length} articles`);
    }

    // Embed the same batch for semantic retrieval. Batched rather than
    // per-article, so this is a couple of requests even for a large run —
    // cheap enough to sit behind scoring rather than deferred further. A
    // failure leaves `embedding` null for the next backfill pass to retry.
    if (scoreTargets.length > 0) {
      const rows = await getArticlesForEmbeddingBySlugs(scoreTargets.map((t) => t.slug));
      const { vectors, quotaExhausted } = await embedDocuments(rows.map(embeddingInput));

      let embedded = 0;
      for (const [i, vector] of vectors.entries()) {
        if (!vector) continue;
        await updateArticleEmbedding(rows[i].slug, vector);
        embedded++;
      }
      console.log(
        `[pipeline] Embedded ${embedded}/${rows.length} articles` +
          (quotaExhausted ? " (daily quota reached; the rest retry tomorrow)" : "")
      );
    }

    console.log(
      `[pipeline] Done: ${result.clipped} clipped, ${result.failedClips} failed, ${result.skippedExisting} skipped`
    );
  };

  // When a run is shared (see `getOrStartFetchPipeline`) both callers hold this
  // same `finalize`, and they consume it differently: the route schedules it
  // via `after()` while the scheduler awaits it inline. Memoising the promise
  // rather than an "already ran" flag matters — a flag would let the second
  // caller return immediately and report the run complete while scoring and
  // embedding were still going.
  let finalizePromise: Promise<void> | null = null;
  const finalize = () => (finalizePromise ??= runFinalize());

  return { result, finalize };
}

export type PipelineRun = Awaited<ReturnType<typeof runFetchPipeline>>;

/**
 * In-flight phase-1 runs, keyed by target date.
 *
 * Two things trigger the pipeline — the hourly cron and a fresh load of the
 * feed page (`Feed.tsx` fires `/api/fetch` on first mount, and a refresh
 * counts as a fresh mount) — so overlapping runs are ordinary, not an edge
 * case. They stay *correct* on their own: inserts dedupe on `source_id` and
 * unique constraints turn races into a logged duplicate. What they waste is
 * a second pass over nine feeds, a second round of clipping aimed at the same
 * source sites, and a second `matchStories()`.
 *
 * Per-process, so this would not survive being scaled to multiple replicas.
 */
const inFlight = new Map<string, Promise<PipelineRun>>();

/**
 * Joins the in-flight fetch for a date if one is running, otherwise starts it.
 *
 * Kept separate from `runFetchPipeline` so the sharing is visible where it is
 * used: a function that silently returned someone else's run — ignoring the
 * arguments it was handed — would be a trap for the next caller.
 *
 * The entry clears when phase 1 resolves, not when `finalize` does. That
 * releases the slot before the multi-minute scoring tail, which is both
 * necessary (holding it would stall the next hourly run) and safe: a later run
 * finds these articles already inserted, so its own `scoreTargets` is empty
 * and it never re-scores them.
 */
export function getOrStartFetchPipeline(options?: {
  date?: string;
}): Promise<PipelineRun> {
  // Resolved here and passed down, so the map key and the run it guards can
  // never disagree about which day is being fetched.
  const targetDate = options?.date || format(new Date(), "yyyy-MM-dd");

  const existing = inFlight.get(targetDate);
  if (existing) {
    console.log(`[pipeline] Joining in-flight fetch for ${targetDate}`);
    return existing;
  }

  const run = runFetchPipeline({ date: targetDate });
  inFlight.set(targetDate, run);

  // Cleanup gets its own handled branch; the caller still sees the rejection.
  // The identity check keeps a slow failure from evicting a newer run.
  run
    .catch(() => {})
    .finally(() => {
      if (inFlight.get(targetDate) === run) inFlight.delete(targetDate);
    });

  return run;
}
