"use client";

/* eslint-disable react-hooks/refs -- Animation state (generation counters, previous keys, FLIP flags) uses refs during render intentionally to avoid cascading re-renders */
import { useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import type { ArticleWithRelated } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";
import { ArticleRow } from "./ArticleRow";
import { ArticleContextMenu } from "./ArticleContextMenu";
import { LoadingCard, LoadingRow } from "./LoadingCard";
import { BallBouncingLoader } from "./BallBouncingLoader";
import { useFlipAnimation } from "./useFlipAnimation";
import {
  ENTRANCE_LIMIT,
  entranceAnimate,
  entranceInitial,
  entranceTransition,
} from "./article-shared";

export type ViewMode = "grid" | "list";

interface ArticleGridProps {
  articles: ArticleWithRelated[];
  loading: boolean;
  fetching?: boolean;
  view?: ViewMode;
  sort?: string;
  rescoringArticles?: Set<string>;
  onRescore?: (slug: string) => void;
  onDelete?: (slug: string) => Promise<void>;
  lastRescoredSlug?: string | null;
  skipEntranceRef?: React.MutableRefObject<boolean>;
}

export function ArticleGrid({ articles, loading, fetching, view = "grid", sort, rescoringArticles, onRescore, onDelete, lastRescoredSlug, skipEntranceRef }: ArticleGridProps) {
  const genRef = useRef(0);
  const prevKeysRef = useRef<Set<string>>(new Set());
  const skipGenRef = useRef(false);
  const currentKeys = new Set(articles.map((a) => a.slug));
  const keysChanged = currentKeys.size !== prevKeysRef.current.size ||
    [...currentKeys].some((s) => !prevKeysRef.current.has(s));

  let enableLayout = true;
  let skipEntrance = false;
  if (keysChanged) {
    if (skipGenRef.current || skipEntranceRef?.current) {
      skipEntrance = !!skipEntranceRef?.current;
      if (skipEntranceRef) skipEntranceRef.current = false;
    } else {
      genRef.current++;
      enableLayout = false;
    }
  }
  const prevViewRef = useRef(view);
  if (prevViewRef.current !== view) {
    prevViewRef.current = view;
    genRef.current++;
    enableLayout = false;
  }
  const prevSortRef = useRef(sort);
  const sortChangePendingRef = useRef(false);
  if (prevSortRef.current !== sort) {
    prevSortRef.current = sort;
    sortChangePendingRef.current = true;
    genRef.current++;
    enableLayout = false;
  }
  // Render 1 (sort changed, old data under blur) already incremented genRef above.
  // Render 2 (new data arrived, fetching done): force entrance again so the
  // fresh articles always get entrance animation, regardless of keysChanged.
  if (sortChangePendingRef.current && !fetching) {
    sortChangePendingRef.current = false;
    genRef.current++;
    enableLayout = false;
  }

  skipGenRef.current = false;
  prevKeysRef.current = currentKeys;

  const handleDelete = useCallback((slug: string) => {
    skipGenRef.current = true;
    onDelete?.(slug).catch(() => {
      skipGenRef.current = false;
    });
  }, [onDelete]);

  const scrollTargetRef = useRef<string | null>(null);
  useEffect(() => {
    scrollTargetRef.current = lastRescoredSlug ?? null;
  }, [lastRescoredSlug]);

  const onLayoutDone = useCallback((slug: string, el: HTMLElement) => {
    if (slug !== scrollTargetRef.current) return;
    scrollTargetRef.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const setCardRef = useFlipAnimation({
    enabled: enableLayout,
    deps: [articles, view],
    onSettled: onLayoutDone,
  });

  if (loading) {
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

  if (articles.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted text-sm">No articles for this date.</p>
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
          className={
            view === "list"
              ? "flex flex-col gap-2"
              : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          }
          style={{
            opacity: fetching ? 0.5 : 1,
            filter: fetching ? "blur(1px)" : "none",
            transition: "opacity 0.15s ease, filter 0.15s ease",
            pointerEvents: fetching ? "none" : undefined,
          }}
        >
        {articles.map((article, i) => {
          const cardKey = `${article.storyGroup || article.slug}-${genRef.current}`;
          return (
          <motion.div
            key={cardKey}
            ref={(el) => setCardRef(article.slug, el)}
            initial={genRef.current > 0 && !skipEntrance && i < ENTRANCE_LIMIT ? entranceInitial : false}
            animate={entranceAnimate}
            transition={entranceTransition(i)}
          >
            <ArticleContextMenu
              slug={article.slug}
              sourceUrl={article.sourceUrl}
              sourceDomain={article.sourceDomain}
              title={article.title}
              onRescore={onRescore}
              onDelete={handleDelete}
            >
              {(menuTrigger, setActiveSlug) =>
                view === "list" ? (
                  <ArticleRow article={article} rescoringArticles={rescoringArticles} menuTrigger={menuTrigger} onActiveSlugChange={setActiveSlug} />
                ) : (
                  <ArticleCard article={article} rescoringArticles={rescoringArticles} menuTrigger={menuTrigger} onActiveSlugChange={setActiveSlug} />
                )
              }
            </ArticleContextMenu>
          </motion.div>
          );
        })}
        </div>
      </div>
  );
}
