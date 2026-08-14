"use client";

import { AskArticleCard } from "./AskArticleCard";
import type { RetrievedArticle } from "@/lib/types";

/**
 * The retrieved articles under an answer, separated into the ones it cited and
 * the rest.
 *
 * The grid shows what retrieval returned, which is not what the answer used: a
 * real question about AI chips ran four searches and put 45 cards under a
 * reply that cited nine of them, with nothing marking which nine.
 *
 * Both halves are worth keeping. What was cited is the evidence for the
 * answer; what was not is how you tell a thin answer from a thin search, which
 * is the first thing you want to know when a reply disappoints.
 *
 * Rendered only once the answer is complete — `AskPage` withholds it while
 * streaming — because which articles were cited is not knowable until then.
 */

/**
 * Slugs the answer linked to.
 *
 * Matching the href rather than the link text: the prompt asks for
 * `[Title](/article/the-slug)`, and the slug is the only part of that the model
 * cannot paraphrase. `slugify(strict)` emits `[a-z0-9-]` and nothing else, so
 * the character class ends exactly where the closing paren begins.
 *
 * A slug can be cited that has no card here — the model can link an article
 * found during an earlier question, whose card sits on that earlier message —
 * so this is only ever used to test membership, never to look articles up.
 */
function citedSlugs(content: string): Set<string> {
  return new Set(Array.from(content.matchAll(/\/article\/([a-z0-9-]+)/g), (m) => m[1]));
}

function Grid({
  articles,
  label,
  entrance,
  offset = 0,
}: {
  articles: RetrievedArticle[];
  label?: string;
  entrance: boolean;
  /** Cards rendered above this group, so the stagger carries across both. */
  offset?: number;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs text-muted">{label}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {articles.map((article, i) => (
          <AskArticleCard
            key={article.slug}
            article={article}
            index={offset + i}
            entrance={entrance}
          />
        ))}
      </div>
    </div>
  );
}

export function AskArticleGroups({
  articles,
  content,
  entrance,
}: {
  articles: RetrievedArticle[];
  content: string;
  /** False for a conversation restored from session storage; see `AskPage`. */
  entrance: boolean;
}) {
  const cited = citedSlugs(content);
  const used = articles.filter((a) => cited.has(a.slug));
  const rest = articles.filter((a) => !cited.has(a.slug));

  // One group is not a division. Labelling it anyway is still worth doing:
  // alone, "Cited" says the search was all signal and "Also found" says the
  // answer leaned on none of it.
  if (used.length === 0 || rest.length === 0) {
    return (
      <Grid
        articles={articles}
        label={used.length > 0 ? "Cited" : "Also found"}
        entrance={entrance}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Grid articles={used} label="Cited" entrance={entrance} />
      {/* Continuing the stagger rather than restarting it, so the two groups
          read as one arrival that happens to be divided. */}
      <Grid articles={rest} label="Also found" entrance={entrance} offset={used.length} />
    </div>
  );
}
