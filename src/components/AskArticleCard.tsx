"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { RetrievedArticle } from "@/lib/types";
import { feedColor } from "./article-shared";

/**
 * A retrieved article, as shown beside an answer.
 *
 * Deliberately not `ArticleCard`. That component takes a full `Article` and is
 * built for browsing a feed — 220px tall, source switcher, relevance score.
 * Retrieval returns a lean row on purpose, and here a card is evidence for a
 * claim rather than something to browse, so it stays compact and carries the
 * one fact a feed card has no reason to: that several outlets ran the story.
 *
 * The height is fixed for the same reason `ArticleCard`'s is. These arrive in a
 * grid, and titles run from one line to three; left to size themselves the rows
 * come out ragged, which reads as disorder in what is meant to be a tidy
 * citation list.
 */
const CARD_HEIGHT = "h-[148px]";

export function AskArticleCard({
  article,
  index,
}: {
  article: RetrievedArticle;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3), ease: "easeOut" }}
    >
      <Link
        href={`/article/${article.slug}`}
        className={`flex ${CARD_HEIGHT} flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-background p-3.5 transition-colors hover:border-accent/40`}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted">
          {/* Same treatment as the feed's cards and rows, so a feed reads as
              the same thing wherever it appears. */}
          <span
            className={`font-medium uppercase tracking-wider ${feedColor[article.feed] ?? "text-muted"}`}
          >
            {article.feed}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">{article.sourceDomain}</span>
          <span aria-hidden>·</span>
          <time dateTime={article.date} className="shrink-0">
            {article.date}
          </time>
        </div>

        <h4 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {article.title}
        </h4>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted">{article.summary}</p>

        {/* Pinned to the bottom so cards with and without it still line up. */}
        {article.alsoReportedBy.length > 0 && (
          <p className="mt-auto truncate text-[11px] text-muted">
            Also reported by {article.alsoReportedBy.join(", ")}
          </p>
        )}
      </Link>
    </motion.div>
  );
}
