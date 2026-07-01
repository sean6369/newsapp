import { useState, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import type { Article, ArticleWithRelated } from "@/lib/types";

export function useSourceSwitcher(article: ArticleWithRelated) {
  const sources = useMemo(() => {
    const list: Article[] = [article];
    if (article.relatedArticles) list.push(...article.relatedArticles);
    return list;
  }, [article]);

  const [sourceIndex, setSourceIndex] = useState(0);
  const directionRef = useRef(1);
  const touchStartX = useRef(0);
  const swipedRef = useRef(false);

  // When a source is removed (deleted), reset to primary.
  // Direction must be set during render (before AnimatePresence reads it);
  // the state update must go through useLayoutEffect.
  const safeIndex = Math.min(sourceIndex, sources.length - 1);
  const prevLenRef = useRef(sources.length);
  /* eslint-disable react-hooks/refs -- animation direction must be set during render before AnimatePresence reads it */
  if (sources.length < prevLenRef.current) {
    directionRef.current = -1; // slide backward toward primary
  }
  /* eslint-enable react-hooks/refs */
  useLayoutEffect(() => {
    if (sources.length < prevLenRef.current) {
      setSourceIndex(0);
    }
    prevLenRef.current = sources.length;
  }, [sources.length]);

  const active = sources[safeIndex];
  const hasSwitcher = sources.length > 1;

  const prev = useCallback(() => {
    directionRef.current = -1;
    setSourceIndex((i) => (i - 1 + sources.length) % sources.length);
  }, [sources.length]);

  const next = useCallback(() => {
    directionRef.current = 1;
    setSourceIndex((i) => (i + 1) % sources.length);
  }, [sources.length]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    swipedRef.current = false;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > 50 && hasSwitcher) {
      swipedRef.current = true;
      if (deltaX < 0) next();
      else prev();
    }
  }, [hasSwitcher, next, prev]);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (swipedRef.current) {
      e.preventDefault();
      swipedRef.current = false;
    }
  }, []);

  return {
    sources,
    sourceIndex: safeIndex,
    active,
    hasSwitcher,
    direction: directionRef,
    prev,
    next,
    swipeHandlers: { onClick, onTouchStart, onTouchEnd },
  };
}
