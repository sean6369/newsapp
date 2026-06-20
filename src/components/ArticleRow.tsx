"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import type { ArticleWithRelated } from "@/lib/types";
import { feedColor, scoreColor, slideVariants } from "./article-shared";
import { useSourceSwitcher } from "@/hooks/useSourceSwitcher";

interface ArticleRowProps {
  article: ArticleWithRelated;
  rescoringArticles?: Set<string>;
  menuTrigger?: React.ReactNode;
  onActiveSlugChange?: (slug: string) => void;
}

export function ArticleRow({ article, rescoringArticles, menuTrigger, onActiveSlugChange }: ArticleRowProps) {
  const { active, hasSwitcher, sourceIndex, direction, sources, prev, next, swipeHandlers } = useSourceSwitcher(article);
  const rescoring = rescoringArticles?.has(active.slug) ?? false;

  useEffect(() => {
    onActiveSlugChange?.(active.slug);
  }, [active.slug, onActiveSlugChange]);

  return (
    <Link
      href={`/article/${active.slug}`}
      className="relative flex flex-col bg-background border-2 border-border rounded-lg px-5 py-3.5 hover:border-accent/40 transition-colors group overflow-hidden"
      {...swipeHandlers}
    >
      <AnimatePresence mode="wait" custom={direction.current} initial={false}>
        <motion.div
          key={active.slug}
          custom={direction.current}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.15, ease: "easeInOut" }}
          className="relative"
        >
          <div className="absolute top-0 right-0 flex items-center gap-1">
            {menuTrigger}
            <span className={`text-xs font-medium ${rescoring ? "text-muted" : scoreColor(active.relevanceScore)}`}>
              {rescoring ? (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                active.relevanceScore !== null ? active.relevanceScore.toFixed(1) : "-"
              )}
            </span>
          </div>

          <h2 className="font-serif text-base font-medium leading-snug group-hover:text-accent transition-colors truncate pr-8 max-md:pr-14">
            {active.title}
          </h2>

          <div className="flex items-center mt-1">
            <span className="flex-1 flex items-center gap-2 text-xs text-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://www.google.com/s2/favicons?domain=${active.sourceDomain}&sz=16`} alt="" width={14} height={14} className="rounded-sm" />
              <span>{active.sourceDomain}</span>
              <span>&middot;</span>
              <span className={`uppercase tracking-wider font-medium ${feedColor[active.feed] || "text-muted"}`}>{active.feed}</span>
              {active.readingTime > 0 && (
                <>
                  <span>&middot;</span>
                  <span>{active.readingTime} min</span>
                </>
              )}
            </span>
            <span className="flex-1" />
            <span className="flex-1 text-right">
              {!active.clipped && (
                <span className="text-[12px] italic text-muted">
                  *summary
                </span>
              )}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>

      {hasSwitcher && (
        <>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); prev(); }}
            className="absolute left-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center text-muted/0 group-hover:text-muted hover:!text-foreground transition-colors cursor-pointer"
            aria-label="Previous source"
          >
            <svg width="14" height="36" viewBox="0 0 12 28" fill="none">
              <path d="M10 2L2 14L10 26" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); next(); }}
            className="absolute right-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center text-muted/0 group-hover:text-muted hover:!text-foreground transition-colors cursor-pointer"
            aria-label="Next source"
          >
            <svg width="14" height="36" viewBox="0 0 12 28" fill="none">
              <path d="M2 2L10 14L2 26" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
            {sources.map((_, i) => (
              <span
                key={i}
                className={`block rounded-full transition-colors ${
                  i === sourceIndex
                    ? "w-1.5 h-1.5 bg-foreground"
                    : "w-1.5 h-1.5 bg-border"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </Link>
  );
}
