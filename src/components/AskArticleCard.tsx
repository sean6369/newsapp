"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { RetrievedArticleRef } from "@/lib/types";
import { feedColor } from "./article-shared";

/**
 * A retrieved article, as shown beside an answer.
 *
 * Deliberately not `ArticleCard`. That component takes a full `Article` and
 * is built for browsing a feed — fixed height, source switcher, relevance
 * score. Retrieval returns a lean row on purpose, and here the card is
 * evidence for a claim rather than something to browse, so it stays compact
 * and carries the one fact the feed card has no reason to: that several
 * outlets ran the same story.
 */
export function AskArticleCard({
  article,
  index,
}: {
  article: RetrievedArticleRef;
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
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3.5 transition-colors hover:border-accent/40"
      >
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className={feedColor[article.feed] ?? "text-muted"}>{article.feed}</span>
          <span aria-hidden>·</span>
          <span>{article.sourceDomain}</span>
          <span aria-hidden>·</span>
          <time dateTime={article.date}>{article.date}</time>
        </div>

        <h4 className="text-sm font-medium leading-snug text-foreground">
          {article.title}
        </h4>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted">
          {article.summary}
        </p>

        {article.alsoReportedBy.length > 0 && (
          <p className="text-[11px] text-muted">
            Also reported by {article.alsoReportedBy.join(", ")}
          </p>
        )}
      </Link>
    </motion.div>
  );
}
