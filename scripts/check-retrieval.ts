import { db } from "../src/lib/db/index";
import { hybridSearchArticles } from "../src/lib/db/queries";
import { GEMINI_API_KEY, geminiUrl, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../src/lib/gemini";
import { sql } from "drizzle-orm";

/**
 * Compares the two arms of hybrid retrieval against real questions.
 *
 * The point is not "did it return something" — the SQL was proven long ago —
 * but whether fusion does any work: whether articles both arms found rise
 * above articles only one found, and whether the semantic arm surfaces
 * anything the lexical arm misses. If the two never overlap, RRF is only
 * interleaving two lists and the tuning is wrong.
 *
 * Questions are phrased as a reader would ask them, deliberately avoiding the
 * corpus's own vocabulary, since matching the corpus's wording is precisely
 * what the lexical arm already does well.
 */
const QUESTIONS = [
  "is it getting more expensive to buy a home in singapore",
  "how are governments restricting advanced computer chips",
  "what are central banks doing about borrowing costs",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embeds a question, waiting out rate limits rather than giving up on them. */
async function embedQuestion(text: string, attempts = 6): Promise<number[] | null> {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${geminiUrl("embedContent", EMBEDDING_MODEL)}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });

    if (res.ok) return (await res.json()).embedding.values as number[];

    if (res.status !== 429) {
      console.log(`  embedding failed: HTTP ${res.status}`);
      return null;
    }

    const body = await res.json().catch(() => null);
    const delay = body?.error?.details?.find((d: { retryDelay?: string }) => d.retryDelay)?.retryDelay;
    const waitMs = Math.min((parseFloat(String(delay).replace("s", "")) || 20) * 1000 + 1000, 45_000);
    if (i === attempts) {
      console.log(`  still rate limited after ${attempts} attempts — quota not yet free`);
      return null;
    }
    console.log(`  rate limited, waiting ${Math.round(waitMs / 1000)}s (${i}/${attempts - 1})`);
    await sleep(waitMs);
  }
  return null;
}

async function main() {
  const [{ n }] = (await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS n FROM articles
  `)) as unknown as Array<{ n: number }>;
  console.log(`embedded corpus: ${n} articles\n`);

  let fusionWins = 0;
  let semanticOnlyFinds = 0;

  for (const q of QUESTIONS) {
    console.log(`\n${"=".repeat(72)}\n"${q}"`);
    const vec = await embedQuestion(q);
    if (!vec) continue;

    const rows = await hybridSearchArticles({ query: q, embedding: vec, limit: 8 });
    const both = rows.filter((r) => r.lex_rank && r.vec_rank);
    const vecOnly = rows.filter((r) => !r.lex_rank && r.vec_rank);
    const lexOnly = rows.filter((r) => r.lex_rank && !r.vec_rank);

    for (const r of rows) {
      const arms = `${r.lex_rank ? "L" + String(r.lex_rank).padEnd(2) : "L– "} ${r.vec_rank ? "V" + String(r.vec_rank).padEnd(2) : "V– "}`;
      const flag = r.lex_rank && r.vec_rank ? " ←both" : "";
      console.log(`  ${r.score.toFixed(5)} [${arms}] ${r.title.slice(0, 58)}${flag}`);
    }

    console.log(`  → found by both: ${both.length} | semantic only: ${vecOnly.length} | lexical only: ${lexOnly.length}`);
    if (both.length > 0 && rows[0].lex_rank && rows[0].vec_rank) fusionWins++;
    semanticOnlyFinds += vecOnly.length;
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`questions where an agreed-on article ranked first: ${fusionWins}/${QUESTIONS.length}`);
  console.log(`articles the semantic arm found that lexical missed: ${semanticOnlyFinds}`);

  await db.$client.end();
}

main();
