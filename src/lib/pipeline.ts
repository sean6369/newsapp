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
import { insertArticle, getExistingArticles, updateArticleMetadata, matchStories, updateRelevanceScore } from "./db/queries";
import { scoreArticle } from "./scorer";
import { extractAndLinkForArticle } from "./extractor";
import { extractDomain, makeSlug } from "./articles";
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
 * - **Phase 2 (`finalize`):** relevance scoring (rate-limited) and entity
 *   extraction. Returned as a continuation so the HTTP route can defer it past
 *   the response via `after()` (keeping the request under Cloudflare's ~100s
 *   limit so the feed's auto-refresh still fires), while the scheduler awaits
 *   it inline.
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
  let scoreTargets: { slug: string; raw: RawArticle }[] = [];
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
      return { slug: article.slug, raw: rawArticle };
    });

    scoreTargets = inserted.filter(
      (t): t is { slug: string; raw: RawArticle } => t !== null
    );
  } else {
    console.log("[pipeline] No new articles to process");
  }

  // 4. Match stories across sources (CNA ↔ ST). Kept in phase 1 — it's a single
  //    fast SQL query with no external API, so grouping is done before the
  //    response and is visible as soon as new articles slide in.
  await matchStories();

  // Phase 2: relevance scoring + entity extraction. Deferred so the caller can
  // run it after sending the response (HTTP route) or inline (scheduler).
  const finalize = async () => {
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

    // Extract entities and topics for newly inserted articles.
    if (newArticles.length > 0) {
      const slugsToExtract = newArticles.map((a) =>
        makeSlug(a.title, extractDomain(a.sourceUrl), a.feed)
      );

      console.log(`[pipeline] Extracting entities/topics for ${slugsToExtract.length} articles...`);
      let extracted = 0;
      await processInBatches(slugsToExtract, MAX_CONCURRENT, async (slug) => {
        try {
          const success = await extractAndLinkForArticle(slug);
          if (success) extracted++;
        } catch (err) {
          console.error(`[pipeline] Extraction failed for ${slug}:`, err);
        }
      });
      console.log(`[pipeline] Extracted entities/topics for ${extracted}/${slugsToExtract.length} articles`);
    }

    console.log(
      `[pipeline] Done: ${result.clipped} clipped, ${result.failedClips} failed, ${result.skippedExisting} skipped`
    );
  };

  return { result, finalize };
}
