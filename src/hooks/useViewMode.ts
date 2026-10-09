"use client";

import { useCallback, useState } from "react";
import type { ViewMode } from "@/components/ArticleGrid";
import { parseViewCookie, setViewCookie } from "@/lib/view-cookie";

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * The page's grid/list choice, kept in its cookie.
 *
 * Starts from the cookie, not the prop, whenever there is a document to read
 * it from. The server reads the same cookie to render `initialView`, but only
 * when it renders: a toggle writes the cookie without asking for a new render,
 * and back from an article the router restores the page's cached render, prop
 * and all. Starting from the prop opened the page on whichever view it had
 * when it was first loaded. On a cold load the two agree, so hydration sees
 * the view the server rendered.
 */
export function useViewMode(cookieName: string, initialView: ViewMode) {
  const [view, setView] = useState<ViewMode>(() =>
    typeof document === "undefined"
      ? initialView
      : parseViewCookie(readCookie(cookieName), initialView)
  );

  const changeView = useCallback(
    (selected: ViewMode) => {
      setView(selected);
      setViewCookie(cookieName, selected);
    },
    [cookieName]
  );

  return [view, changeView] as const;
}
