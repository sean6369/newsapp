"use client";

import dynamic from "next/dynamic";

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
  // Reserves the mounted layout so the page does not shift as it loads.
  loading: () => <div className="mx-auto min-h-svh w-full max-w-3xl px-5 pt-16" />,
});

export function AskLoader() {
  return <AskPage />;
}
