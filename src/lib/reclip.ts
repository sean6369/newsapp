import { clipArticle, TRUNCATION_MARKER_PHRASES } from "./clipper";
import { estimateReadingTime, stubContent } from "./articles";
import {
  countClippedArticles,
  getClipsContaining,
  getUnclippedArticles,
  markArticleClipped,
  markArticleUnclipped,
} from "./db/queries";

/**
 * Re-running the clipper over the articles it previously gave up on.
 *
 * The pipeline clips once and never looks again: a story that was behind a
 * timeout, a 502, or a WAF challenge at the moment it was ingested stays
 * summary-only for good, even though the page it points at has been readable
 * ever since. Nothing in the ingest path can fix that, because by the time the
 * article exists the one attempt it gets has already been spent.
 *
 * So this is deliberately a separate pass rather than a step inside
 * `runPipeline`. Most of what it retries will fail again — a subscriber-only
 * WSJ story is not going to start clipping — and folding that into the hourly
 * cron would mean re-fetching the same couple of hundred dead URLs every hour
 * to rescue the handful that recovered. Run on demand, or on a slow schedule.
 */

/** Concurrent fetches. Matches the pipeline's own clip concurrency. */
const MAX_CONCURRENT = 3;

export interface ReclipResult {
  attempted: number;
  recovered: number;
  stillFailing: number;
  /** Rows whose write failed. Distinct from a page that simply would not clip. */
  errored: number;
  /** Domains that recovered at least one article, most first. */
  byDomain: { domain: string; recovered: number; attempted: number }[];
}

/**
 * Runs `fn` over `items`, at most `concurrency` at a time.
 *
 * `fn` is expected to absorb its own failures and return an outcome either
 * way — a rejection here would abandon the whole pass partway through, after
 * some rows had already been written and with no summary to say which.
 */
async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]);
      }
    })
  );
  return out;
}

/**
 * Retries the most recent unclipped articles, writing back the ones that
 * succeed.
 *
 * Recent rather than oldest for the reason given on `getUnclippedArticles`:
 * the far end of the backlog is dominated by articles that can never clip, so
 * a limited run spends its budget better at the near end.
 *
 * `dryRun` reports what would be recovered without touching a row, which is
 * how to check a clipper change against the real backlog before committing to
 * it.
 */
export async function reclipFailed(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<ReclipResult> {
  const limit = options?.limit ?? 100;
  const dryRun = options?.dryRun ?? false;

  const pending = await getUnclippedArticles(limit);
  if (pending.length === 0) {
    return { attempted: 0, recovered: 0, stillFailing: 0, errored: 0, byDomain: [] };
  }

  const outcomes = await processInBatches(pending, MAX_CONCURRENT, async (article) => {
    const failure = { domain: article.sourceDomain, recovered: false, errored: false };

    const clipped = await clipArticle(article.sourceUrl);
    if (!clipped) return failure;

    try {
      if (!dryRun) {
        await markArticleClipped(
          article.slug,
          clipped.content,
          estimateReadingTime(clipped.content)
        );
      }
    } catch (error) {
      console.warn(`[reclip] Could not write ${article.slug}:`, error);
      return { ...failure, errored: true };
    }

    console.log(
      `[reclip] ${dryRun ? "Would recover" : "Recovered"} ${article.sourceDomain}: ${article.slug}`
    );
    return { domain: article.sourceDomain, recovered: true, errored: false };
  });

  const tally = new Map<string, { recovered: number; attempted: number }>();
  for (const outcome of outcomes) {
    const entry = tally.get(outcome.domain) ?? { recovered: 0, attempted: 0 };
    entry.attempted++;
    if (outcome.recovered) entry.recovered++;
    tally.set(outcome.domain, entry);
  }

  const recovered = outcomes.filter((o) => o.recovered).length;
  return {
    attempted: outcomes.length,
    recovered,
    stillFailing: outcomes.length - recovered,
    errored: outcomes.filter((o) => o.errored).length,
    byDomain: [...tally.entries()]
      .map(([domain, counts]) => ({ domain, ...counts }))
      .filter((d) => d.recovered > 0)
      .sort((a, b) => b.recovered - a.recovered),
  };
}

export interface RepairResult {
  inspected: number;
  suspect: number;
  withdrawn: number;
  reclipped: number;
  /** Rows whose write failed, so their stored state is still the old one. */
  errored: number;
  byDomain: { domain: string; withdrawn: number }[];
}

/**
 * Withdraws stored clips that turn out to be teasers.
 *
 * `clipped` records a judgement the clipper made at ingest time, under
 * whatever rules it had then. Tighten those rules and the column keeps the old
 * answer: rows that pre-date the change go on claiming a body they never had,
 * and nothing in the ingest path revisits them, because ingest only ever looks
 * at articles it is seeing for the first time.
 *
 * Each suspect row is re-clipped before anything is withdrawn, so a page that
 * has since been un-gated keeps its clip and gains the full text instead of
 * being demoted on the strength of what was stored months ago.
 */
export async function repairTruncatedClips(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<RepairResult> {
  const limit = options?.limit ?? 100;
  const dryRun = options?.dryRun ?? false;

  const [inspected, suspect] = await Promise.all([
    countClippedArticles(),
    getClipsContaining(TRUNCATION_MARKER_PHRASES, limit),
  ]);
  if (suspect.length === 0) {
    return { inspected, suspect: 0, withdrawn: 0, reclipped: 0, errored: 0, byDomain: [] };
  }

  const outcomes = await processInBatches(suspect, MAX_CONCURRENT, async (article) => {
    const fresh = await clipArticle(article.sourceUrl);
    const outcome = fresh
      ? { done: "Re-clipped in full", pending: "Would re-clip in full" }
      : { done: "Withdrew teaser", pending: "Would withdraw teaser" };

    try {
      if (!dryRun) {
        if (fresh) {
          await markArticleClipped(article.slug, fresh.content, estimateReadingTime(fresh.content));
        } else {
          await markArticleUnclipped(article.slug, stubContent(article.sourceUrl));
        }
      }
    } catch (error) {
      console.warn(`[reclip] Could not write ${article.slug}:`, error);
      return { domain: article.sourceDomain, withdrawn: false, errored: true };
    }

    console.log(
      `[reclip] ${dryRun ? outcome.pending : outcome.done} ${article.sourceDomain}: ${article.slug}`
    );
    return { domain: article.sourceDomain, withdrawn: !fresh, errored: false };
  });

  const tally = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.withdrawn) tally.set(outcome.domain, (tally.get(outcome.domain) ?? 0) + 1);
  }

  const withdrawn = outcomes.filter((o) => o.withdrawn).length;
  const errored = outcomes.filter((o) => o.errored).length;
  return {
    inspected,
    suspect: suspect.length,
    withdrawn,
    reclipped: outcomes.length - withdrawn - errored,
    errored,
    byDomain: [...tally.entries()]
      .map(([domain, count]) => ({ domain, withdrawn: count }))
      .sort((a, b) => b.withdrawn - a.withdrawn),
  };
}
