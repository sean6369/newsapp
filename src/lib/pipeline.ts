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
import { insertArticle, getExistingArticles, updateArticleMetadata, matchStories } from "./db/queries";
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

export async function runFetchPipeline(options?: {
  date?: string;
}): Promise<PipelineResult> {
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
    `[pipeline] ${unique.length} unique articles (${allArticles.length - unique.length} in-batch dupes, ${bySourceId.size + bySourceUrl.size} already in DB)`
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
            console.log(`[pipeline] Skipped metadata update for "${a.title}" (duplicate source_url)`);
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

  if (newArticles.length > 0) {
    console.log(`[pipeline] Processing ${newArticles.length} new articles...`);

    // 3. Clip and insert to database
    await processInBatches(newArticles, MAX_CONCURRENT, async (rawArticle) => {
      const clipped = await clipArticle(rawArticle.sourceUrl);

      if (clipped) {
        result.clipped++;
      } else {
        result.failedClips++;
      }

      const { article, content } = buildArticle(rawArticle, clipped?.content || null);
      article.relevanceScore = await scoreArticle(rawArticle);
      const inserted = await insertArticle(article, content);

      if (!inserted) {
        console.log(`[pipeline] Skipped duplicate slug "${article.slug}"`);
      }
    });
  } else {
    console.log("[pipeline] No new articles to process");
  }

  // 4. Match stories across sources (CNA ↔ ST) — runs after insertion so new articles are included
  await matchStories();

  // 5. Extract entities and topics for newly inserted articles
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

  return result;
}
