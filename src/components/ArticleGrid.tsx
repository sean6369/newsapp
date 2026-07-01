"use client";

/* eslint-disable react-hooks/refs -- Animation state (generation counters, previous keys, FLIP flags) uses refs during render intentionally to avoid cascading re-renders */
import { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { motion } from "motion/react";
import type { ArticleWithRelated } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";
import { ArticleRow } from "./ArticleRow";
import { ArticleContextMenu } from "./ArticleContextMenu";
import { LoadingCard, LoadingRow } from "./LoadingCard";
import { BallBouncingLoader } from "./BallBouncingLoader";

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

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback((slug: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(slug, el);
    else cardRefs.current.delete(slug);
  }, []);

  const scrollTargetRef = useRef<string | null>(null);
  useEffect(() => {
    scrollTargetRef.current = lastRescoredSlug ?? null;
  }, [lastRescoredSlug]);

  const onLayoutDone = useCallback((slug: string) => {
    if (slug === scrollTargetRef.current) {
      scrollTargetRef.current = null;
      const el = cardRefs.current.get(slug);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  // --- Manual FLIP animation (replaces framer-motion layout) ---
  const prevRectsRef = useRef<Map<HTMLDivElement, DOMRect>>(new Map());
  const runningAnimsRef = useRef<Map<HTMLDivElement, Animation>>(new Map());
  const flipEnabledRef = useRef(true);
  flipEnabledRef.current = enableLayout;

  useLayoutEffect(() => {
    const prev = prevRectsRef.current;

    // Cancel in-progress animations (before paint, no visual flash)
    runningAnimsRef.current.forEach((anim) => anim.cancel());
    runningAnimsRef.current.clear();

    // Capture current layout rects
    const newRects = new Map<HTMLDivElement, DOMRect>();
    const slugByEl = new Map<HTMLDivElement, string>();

    cardRefs.current.forEach((el, slug) => {
      newRects.set(el, el.getBoundingClientRect());
      slugByEl.set(el, slug);
    });

    // Animate position deltas (FLIP: First-Last-Invert-Play)
    if (flipEnabledRef.current && prev.size > 0) {
      newRects.forEach((newRect, el) => {
        const oldRect = prev.get(el);
        if (!oldRect) return;

        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

        const anim = el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 450, easing: "cubic-bezier(0.33, 1.15, 0.5, 1)" },
        );

        runningAnimsRef.current.set(el, anim);

        const slug = slugByEl.get(el);
        if (slug) {
          anim.finished
            .then(() => {
              runningAnimsRef.current.delete(el);
              onLayoutDone(slug);
            })
            .catch(() => {}); // ignore cancel rejection
        }
      });
    }

    prevRectsRef.current = newRects;
  }, [articles, view, onLayoutDone]);

  // Keep prevRects fresh on window resize (no animation, just recapture)
  useEffect(() => {
    const handleResize = () => {
      runningAnimsRef.current.forEach((anim) => anim.cancel());
      runningAnimsRef.current.clear();
      const newRects = new Map<HTMLDivElement, DOMRect>();
      cardRefs.current.forEach((el) => {
        newRects.set(el, el.getBoundingClientRect());
      });
      prevRectsRef.current = newRects;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
            initial={genRef.current > 0 && !skipEntrance && i < 18 ? { opacity: 0, y: 12 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              opacity: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1], delay: Math.min(i * 0.04, 0.25) },
              y: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1], delay: Math.min(i * 0.04, 0.25) },
            }}
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
