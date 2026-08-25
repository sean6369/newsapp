import { db } from "../src/lib/db/index";
import { reclipFailed, repairTruncatedClips } from "../src/lib/reclip";

/**
 * Retries the articles the clipper previously failed on.
 *
 * A script rather than a route because a full pass is a few hundred outbound
 * fetches at three at a time, which outlives any HTTP request, and because
 * most of it is expected to fail — the point is to rescue the minority whose
 * pages have since become readable, or that a clipper fix now handles.
 *
 * Safe to interrupt and re-run: each recovery is written as it completes, and
 * anything still unclipped is simply picked up next time.
 *
 *   npx tsx scripts/reclip.ts                 # 100 most recent failures
 *   npx tsx scripts/reclip.ts --limit 500     # more of the backlog
 *   npx tsx scripts/reclip.ts --dry-run       # report only, write nothing
 *   npx tsx scripts/reclip.ts --repair        # audit stored clips instead
 *
 * Most recent rather than oldest: the far end of the backlog fills up with
 * articles that can never clip — subscriber-only publishers, real paywalls —
 * so a limited run finds more at the near end. `--limit` bounds both
 * directions, and `--dry-run` composes with either.
 *
 * `--repair` runs the opposite direction: it re-checks articles already marked
 * clipped and withdraws the ones holding a paywall teaser. Worth a pass after
 * any change to what the clipper accepts, since `clipped` otherwise preserves
 * whatever the rules were on the day each article was ingested.
 *
 * Needs `DATABASE_URL` in the environment — like the other scripts here, it
 * does not read `.env` itself.
 */

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dryRun = process.argv.includes("--dry-run");
const repair = process.argv.includes("--repair");
const limit = Number(flagValue("--limit") ?? 100);

async function runRepair() {
  console.log(
    `[reclip] Auditing up to ${limit} stored clips for paywall teasers${dryRun ? " (dry run)" : ""}`
  );
  const result = await repairTruncatedClips({ limit, dryRun });

  console.log(
    `\n[reclip] ${result.suspect} suspect of ${result.inspected} clipped — ` +
      `${result.withdrawn} withdrawn, ${result.reclipped} re-clipped in full`
  );

  if (result.byDomain.length > 0) {
    console.log("\nWithdrawn by domain:");
    for (const { domain, withdrawn } of result.byDomain) {
      console.log(`  ${withdrawn}  ${domain}`);
    }
  }

  reportErrors(result.errored);
  if (result.suspect === limit) {
    console.log(`[reclip] Hit the ${limit} cap — re-run to continue`);
  }
  if (dryRun) console.log("\n[reclip] Dry run — no rows were written");
}

/**
 * Write failures are reported separately from articles that would not clip:
 * the first means the archive is not yet in the state this run describes and
 * the pass should be repeated, the second is the ordinary outcome.
 */
function reportErrors(errored: number) {
  if (errored > 0) {
    console.log(`[reclip] ${errored} row(s) could not be written — re-run to retry them`);
    process.exitCode = 1;
  }
}

async function main() {
  if (!Number.isFinite(limit) || limit < 1) {
    console.error("[reclip] --limit must be a positive number");
    process.exitCode = 1;
    return;
  }

  if (repair) return runRepair();

  console.log(`[reclip] Retrying up to ${limit} unclipped articles${dryRun ? " (dry run)" : ""}`);
  const result = await reclipFailed({ limit, dryRun });

  if (result.attempted === 0) {
    console.log("[reclip] Nothing to retry");
    return;
  }

  console.log(
    `\n[reclip] ${result.recovered} recovered, ${result.stillFailing} still failing, of ${result.attempted} attempted`
  );

  if (result.byDomain.length > 0) {
    console.log("\nRecovered by domain:");
    for (const { domain, recovered, attempted } of result.byDomain) {
      console.log(`  ${recovered}/${attempted}  ${domain}`);
    }
  }

  reportErrors(result.errored);
  if (dryRun) console.log("\n[reclip] Dry run — no rows were written");
}

main()
  .catch((error) => {
    console.error("[reclip] Failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
