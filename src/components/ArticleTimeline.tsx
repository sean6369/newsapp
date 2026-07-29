"use client";

/* eslint-disable react-hooks/refs -- Animation bookkeeping (generation counter, previous keys) is read and written during render on purpose, to avoid cascading re-renders */
import { useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import type { Article, ArticleWithRelated } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";
import { ArticleRow } from "./ArticleRow";
import { LoadingCard, LoadingRow } from "./LoadingCard";
import { BallBouncingLoader } from "./BallBouncingLoader";
import { useFlipAnimation } from "./useFlipAnimation";
import type { ViewMode } from "./ArticleGrid";
import {
  ENTRANCE_LIMIT,
  entranceAnimate,
  entranceInitial,
  entranceTransition,
} from "./article-shared";

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
  /** A refetch is in flight. Dims what is on screen behind a loader. */
  fetching?: boolean;
  /**
   * The ordering the articles on screen were produced with. A change replays
   * the entrance animation, so pass the sort the current rows were fetched
   * with rather than the one a pending request is using.
   */
  sort?: string;
  /** Optional slot rendered under each article. Only shown in list view. */
  renderExtra?: (article: T) => React.ReactNode;
  /** Passed through to ArticleRow to override title rendering. */
  renderTitle?: (article: Article) => React.ReactNode;
}

/**
 * Shared article layout: either a date-grouped timeline or a flat list/grid.
 *
 * Mirrors the home feed's motion: rows fade and rise in when the set changes,
 * slide (FLIP) when they only move, and dim behind a loader while a refetch
 * is in flight.
 */
export function ArticleTimeline<T extends ArticleWithRelated>({
  articles,
  view,
  grouped,
  fetching = false,
  sort,
  renderExtra,
  renderTitle,
}: ArticleTimelineProps<T>) {
  // `offset` is the group's start in the flat list, so the entrance stagger
  // can keep counting across group boundaries.
  const dateGroups = useMemo(() => {
    if (!grouped) return [];
    const groups: { date: string; offset: number; articles: T[] }[] = [];
    articles.forEach((article, i) => {
      const last = groups[groups.length - 1];
      if (last && last.date === article.date) {
        last.articles.push(article);
      } else {
        groups.push({ date: article.date, offset: i, articles: [article] });
      }
    });
    return groups;
  }, [articles, grouped]);

  // --- Entrance bookkeeping ---
  // Bumping the generation re-keys every row, so React remounts them and the
  // entrance animation plays again. The first render never animates: on a
  // fresh page load the rows are already there.
  //
  // All of it lives in one ref, recomputed only when the inputs actually
  // change. React can invoke a render more than once for the same props
  // (StrictMode does exactly that in development), and diffing against the
  // keys a second time would compare them to themselves — concluding that a
  // "load more" appended nothing, and dropping the new rows' animation.
  const anim = useRef({
    articles: null as T[] | null,
    view,
    sort,
    grouped,
    keys: [] as string[],
    gen: 0,
    /** Where the entrance stagger counts from: the tail a load-more added to. */
    entranceFrom: 0,
    flip: true,
  });
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
  }, []);

  const state = anim.current;
  if (
    state.articles !== articles ||
    state.view !== view ||
    state.sort !== sort ||
    state.grouped !== grouped
  ) {
    const keys = articles.map((a) => a.slug);
    const prevKeys = state.keys;

    // "Load more" leaves the existing rows alone and adds to the end. Keep
    // them mounted so only the newly appended rows animate in.
    const appendOnly =
      prevKeys.length > 0 &&
      keys.length > prevKeys.length &&
      prevKeys.every((key, i) => keys[i] === key);
    // Anything else — a new result set, a reorder, a different layout — swaps
    // the rows out from under the reader, so they all animate back in.
    const rowsReplaced =
      (!appendOnly &&
        (keys.length !== prevKeys.length || keys.some((key, i) => key !== prevKeys[i]))) ||
      state.view !== view ||
      state.sort !== sort ||
      state.grouped !== grouped;

    if (rowsReplaced) state.gen++;
    // Remounted rows have nowhere to slide from, so FLIP sits out that render.
    state.flip = !rowsReplaced;
    state.entranceFrom = appendOnly ? prevKeys.length : 0;
    state.articles = articles;
    state.view = view;
    state.sort = sort;
    state.grouped = grouped;
    state.keys = keys;
  }

  const { gen, entranceFrom } = state;
  const animateEntrance = mountedRef.current;

  const setCardRef = useFlipAnimation({
    enabled: state.flip,
    deps: [articles, view, grouped],
  });

  function renderArticle(article: T, index: number) {
    const staggerIndex = index - entranceFrom;
    return (
      <motion.div
        key={`${article.slug}-${gen}`}
        ref={(el) => setCardRef(article.slug, el)}
        className={view === "grid" ? undefined : "flex flex-col"}
        initial={
          animateEntrance && staggerIndex >= 0 && staggerIndex < ENTRANCE_LIMIT
            ? entranceInitial
            : false
        }
        animate={entranceAnimate}
        transition={entranceTransition(Math.max(staggerIndex, 0))}
      >
        {view === "grid" ? (
          <ArticleCard article={article} renderTitle={renderTitle} />
        ) : (
          <>
            <ArticleRow article={article} renderTitle={renderTitle} />
            {renderExtra?.(article)}
          </>
        )}
      </motion.div>
    );
  }

  /** `offset` is where `items` starts in the flat list, for a continuous stagger. */
  function renderArticles(items: T[], offset: number) {
    if (view === "grid") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((article, i) => renderArticle(article, offset + i))}
        </div>
      );
    }
    // With an extra slot the rows carry a trailing block, so they need more
    // separation from each other than from their own snippet.
    return (
      <div className={`flex flex-col ${renderExtra ? "gap-6" : "gap-2"}`}>
        {items.map((article, i) => renderArticle(article, offset + i))}
      </div>
    );
  }

  // Nothing to dim yet — show the skeleton the home feed uses on a cold load.
  if (fetching && articles.length === 0) {
    return view === "list" ? (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <LoadingRow key={i} />
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <LoadingCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      {fetching && (
        <div className="sticky top-1/2 z-10 flex justify-center pointer-events-none -mb-[100px]">
          <BallBouncingLoader />
        </div>
      )}
      <div
        style={{
          opacity: fetching ? 0.5 : 1,
          filter: fetching ? "blur(1px)" : "none",
          transition: "opacity 0.15s ease, filter 0.15s ease",
          pointerEvents: fetching ? "none" : undefined,
        }}
      >
        {!grouped ? (
          renderArticles(articles, 0)
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[7px] top-2 bottom-0 w-px bg-border" />

            {dateGroups.map((group, i) => (
              // Groups are consecutive runs, so a date is unique only while
              // the articles are date-ordered. Index-qualify the key so a
              // transient out-of-order list degrades visually instead of
              // throwing.
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
                    {group.articles.length} article
                    {group.articles.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Articles indented past timeline */}
                <div className="pl-8">{renderArticles(group.articles, group.offset)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
