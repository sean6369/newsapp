import { format } from "date-fns";
import { fetchDigestUrls, scrapeDigestPage, fetchCNAArticles, fetchSTArticles } from "./feeds";
import { resolveFeedSources } from "./feed-sources";
import { clipArticle } from "./clipper";
import { buildArticle, estimateReadingTime } from "./articles";
import {
  insertArticle,
  getExistingArticles,
  updateArticleMetadata,
  matchStories,
  updateRelevanceScore,
  updateArticleEmbedding,
  getArticlesForEmbeddingBySlugs,
  getRecentUnembeddedArticles,
  getRecentUnscoredArticles,
  getFeedSourceOverrides,
} from "./db/queries";
import { scoreArticle, isScoringQuotaExhausted } from "./scorer";
import { embedAndStore } from "./embeddings";
import { archiveDaysAgo } from "./dates";
import type { RawArticle, PipelineResult } from "./types";

/**
 * How far back the embedding catch-up looks, and how many rows it repairs per
 * run.
 *
 * The horizon is what keeps this a repair rather than a backfill: it covers
 * the window semantic search is meant to serve and never reaches into older
 * articles left deliberately lexical-only. A week survives a multi-day outage
 * without ever drifting into history.
 *
 * The cap bounds a pathological backlog. At hourly cadence it still repairs
 * far faster than the pipeline ingests, so it converges quickly while never
 * being able to drain a day's allowance in one pass.
 */
const EMBED_HORIZON_DAYS = 7;
const EMBED_CATCHUP_LIMIT = 100;

/**
 * The same repair for relevance scores, on a much smaller allowance.
 *
 * The horizon matches the embedding pass for the same reason it has one, but
 * the cap is deliberately a fraction of it: scoring is the tighter quota.
 * Ingest alone spends a few hundred requests a day against a model that allows
 * 15 a minute, and a hundred per hourly run would add thousands more on top.
 * This drains a backlog over days rather than in an afternoon, which is the
 * right trade when the alternative risks the day's allowance for new articles.
 *
 * Articles older than the horizon stay unscored; `/api/backfill` remains the
 * way to sweep the deep archive deliberately.
 */
const SCORE_HORIZON_DAYS = 7;
const SCORE_CATCHUP_LIMIT = 20;

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

  // 1. Fetch every source the reader has left switched on, in parallel
  //    (TLDR scrapes + CNA/ST RSS).
  //
  // Which sources those are is read fresh on each run rather than captured at
  // import: the settings page writes to the same table, and the hourly cron
  // and a long-lived dev server would otherwise keep fetching from a roster
  // the reader changed hours ago.
  const sources = resolveFeedSources(await getFeedSourceOverrides());
  const enabled = sources.filter((s) => s.enabled);

  // Tasks and their labels are built together so the counts logged below can
  // be attributed: with two parallel arrays, one disabled source would shift
  // every label by one and quietly misreport which outlet returned what.
  const tasks: { label: string; run: () => Promise<RawArticle[]> }[] = [];
  for (const source of enabled) {
    if (source.kind === "tldr") {
      // A TLDR source is more than one fetch: each run re-checks yesterday's
      // digest as well as today's (see `fetchDigestUrls`).
      for (const digest of fetchDigestUrls(targetDate, [source.feed])) {
        tasks.push({
          label: `${source.id} ${digest.date}`,
          run: () => scrapeDigestPage(digest.url, digest.feed, digest.date),
        });
      }
    } else {
      const fetchArticles = source.kind === "cna" ? fetchCNAArticles : fetchSTArticles;
      tasks.push({
        label: source.id,
        run: () => fetchArticles(source.url, source.feed),
      });
    }
  }

  const fetched = await Promise.all(tasks.map((task) => task.run()));
  const allArticles: RawArticle[] = fetched.flat();

  // Deliberately not an early return when every source is off: the rest of
  // this function is a no-op on an empty batch, and `finalize` still has the
  // scoring and embedding repairs to run on articles fetched before the reader
  // turned things off.
  console.log(
    enabled.length === 0
      ? `[pipeline] Every source is switched off (${sources.length} available) — nothing to fetch`
      : `[pipeline] ${fetched.map((rows, i) => `${tasks[i].label}: ${rows.length}`).join(" | ")}`
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
        const updates: {
          title?: string;
          sourceUrl?: string;
          content?: string;
          clipped?: boolean;
          readingTime?: number;
        } = {};
        if (titleChanged) updates.title = a.title;
        if (urlChanged) updates.sourceUrl = a.sourceUrl;

        // Re-clip from the current URL. The flag and the reading time move with
        // the body: this is the one path that can clip an article which failed
        // at ingest, and writing the text alone would leave it a full article
        // still wearing the `*summary` tag and showing no reading time.
        const reclipped = await clipArticle(a.sourceUrl);
        if (reclipped) {
          updates.content = reclipped.content;
          updates.clipped = true;
          updates.readingTime = estimateReadingTime(reclipped.content);
        }

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
    // failure leaves `embedding` null for the catch-up below to retry.
    let quotaSpent = false;
    if (scoreTargets.length > 0) {
      const rows = await getArticlesForEmbeddingBySlugs(scoreTargets.map((t) => t.slug));
      const { embedded, quotaExhausted } = await embedAndStore(rows, updateArticleEmbedding);
      quotaSpent = quotaExhausted;
      console.log(
        `[pipeline] Embedded ${embedded}/${rows.length} articles` +
          (quotaExhausted ? " (daily quota reached; the rest retry next run)" : "")
      );
    }

    // Repair recent articles that never got a score.
    //
    // Sits after the new articles for the same reason the embedding repair
    // does — today's news outranks patching last Tuesday — and draws on its own
    // quota, so it is gated on scoring's daily cap rather than embedding's.
    // Skipped outright once that cap is reached, since every call would return
    // null without leaving the process.
    if (!isScoringQuotaExhausted()) {
      const unscored = await getRecentUnscoredArticles(
        archiveDaysAgo(SCORE_HORIZON_DAYS),
        SCORE_CATCHUP_LIMIT
      );
      if (unscored.length > 0) {
        let repaired = 0;
        await processInBatches(unscored, MAX_CONCURRENT, async (article) => {
          const score = await scoreArticle(article);
          if (score !== null) {
            await updateRelevanceScore(article.slug, score);
            repaired++;
          }
        });
        console.log(
          `[pipeline] Caught up ${repaired}/${unscored.length} unscored articles` +
            (isScoringQuotaExhausted() ? " (daily quota reached)" : "")
        );
      }
    }

    // Repair recent articles that never got a vector.
    //
    // Nothing else retries one. A call that fails on quota or a rate limit
    // leaves a hole, and since the embed step above only ever looks at rows
    // this run inserted, that hole would persist for good — semantic search
    // would silently miss part of a day while lexical still covered it.
    //
    // Runs after the new articles, never before: when the day's allowance is
    // tight, today's news matters more than patching last Tuesday. Skipped
    // entirely once the allowance is gone, since every call would fail the
    // same way.
    if (!quotaSpent) {
      const stale = await getRecentUnembeddedArticles(
        archiveDaysAgo(EMBED_HORIZON_DAYS),
        EMBED_CATCHUP_LIMIT
      );
      if (stale.length > 0) {
        const { embedded, quotaExhausted } = await embedAndStore(stale, updateArticleEmbedding);
        console.log(
          `[pipeline] Caught up ${embedded}/${stale.length} unembedded articles` +
            (quotaExhausted ? " (daily quota reached)" : "")
        );
      }
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
