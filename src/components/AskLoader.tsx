"use client";

import dynamic from "next/dynamic";

import { contentColumn } from "./hero-shared";

/**
 * Loads the Ask page on the client only.
 *
 * The page restores an in-progress conversation from sessionStorage, which the
 * server cannot see. Rendering it on the server would produce markup that
 * disagrees with the first client render, and the alternative — starting empty
 * and restoring in an effect — makes the conversation flash in after mount.
 * There is no server data on this page, so skipping SSR costs nothing.
 */
const AskPage = dynamic(() => import("./AskPage").then((m) => m.AskPage), {
  ssr: false,
  // Reserves the mounted page's frame so nothing shifts as it loads — same
  // wrapper and same top padding the real header uses.
  loading: () => (
    <div className="min-h-dvh bg-background">
      <div className={`${contentColumn} pt-8`} />
    </div>
  ),
});

export function AskLoader() {
  return <AskPage />;
}
