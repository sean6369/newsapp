"use client";

import { useMemo } from "react";
import type { Article, ArticleWithRelated } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";
import { ArticleRow } from "./ArticleRow";
import type { ViewMode } from "./ArticleGrid";

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${day} ${month}`;
}

export function formatDateLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = toDateStr(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  if (date.getFullYear() === today.getFullYear()) return `${day} ${month}`;
  return `${day} ${month} ${date.getFullYear()}`;
}

interface ArticleTimelineProps<T extends ArticleWithRelated> {
  articles: T[];
  view: ViewMode;
  /**
   * Render as a date-grouped vertical timeline. Callers pass `false` when the
   * articles are ordered by something other than date (relevance, rank), where
   * date headings would be meaningless.
   */
  grouped: boolean;
  /** Optional slot rendered under each article. Only shown in list view. */
  renderExtra?: (article: T) => React.ReactNode;
  /** Passed through to ArticleRow to override title rendering. */
  renderTitle?: (article: Article) => React.ReactNode;
}

/**
 * Shared article layout: either a date-grouped timeline or a flat list/grid.
 */
export function ArticleTimeline<T extends ArticleWithRelated>({
  articles,
  view,
  grouped,
  renderExtra,
  renderTitle,
}: ArticleTimelineProps<T>) {
  const dateGroups = useMemo(() => {
    if (!grouped) return [];
    const groups: { date: string; articles: T[] }[] = [];
    for (const article of articles) {
      const last = groups[groups.length - 1];
      if (last && last.date === article.date) {
        last.articles.push(article);
      } else {
        groups.push({ date: article.date, articles: [article] });
      }
    }
    return groups;
  }, [articles, grouped]);

  function renderArticles(items: T[]) {
    if (view === "grid") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((article) => (
            <ArticleCard key={article.slug} article={article} renderTitle={renderTitle} />
          ))}
        </div>
      );
    }
    // With an extra slot the rows carry a trailing block, so they need more
    // separation from each other than from their own snippet.
    return (
      <div className={`flex flex-col ${renderExtra ? "gap-6" : "gap-2"}`}>
        {items.map((article) => (
          <div key={article.slug} className="flex flex-col">
            <ArticleRow article={article} renderTitle={renderTitle} />
            {renderExtra?.(article)}
          </div>
        ))}
      </div>
    );
  }

  if (!grouped) return renderArticles(articles);

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-[7px] top-2 bottom-0 w-px bg-border" />

      {dateGroups.map((group, i) => (
        // Groups are consecutive runs, so a date is unique only while the
        // articles are date-ordered. Index-qualify the key so a transient
        // out-of-order list degrades visually instead of throwing.
        <div key={`${group.date}-${i}`} className={i > 0 ? "mt-8" : ""}>
          {/* Date label with dot */}
          <div className="relative flex items-center gap-3 mb-4">
            <div className="w-[15px] flex-shrink-0 flex justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-accent relative z-10" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {formatDateLabel(group.date)}
            </span>
            <span className="text-xs text-muted">
              {group.articles.length} article{group.articles.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Articles indented past timeline */}
          <div className="pl-8">{renderArticles(group.articles)}</div>
        </div>
      ))}
    </div>
  );
}
