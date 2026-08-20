"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "@heroui/react";
import { parsePastedUrl } from "@/lib/paste-url";
import type { Article } from "@/lib/types";

/**
 * A clip the server is still fetching.
 *
 * Held in React state rather than written into the SWR cache as an optimistic
 * article: a clip has no slug, title, or summary until the page has been read,
 * so there is no article to be optimistic *with*. What the grid can honestly
 * show is the site being read and the slot the card will land in, which is
 * exactly this shape.
 */
export interface PendingClip {
  url: string;
  domain: string;
}

interface LibraryData {
  articles: Article[];
}

interface ClipResponse {
  /** `saved` means the pipeline already had it and it was flagged, not fetched. */
  status: "created" | "saved" | "duplicate";
  article: Article;
  error?: string;
}

const fetcher = async (url: string): Promise<LibraryData> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load your library");
  return response.json();
};

export function useLibrary() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounced into the SWR key, as the feed does, so typing is one request per
  // pause rather than one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const swrKey = debouncedSearch.trim()
    ? `/api/library?search=${encodeURIComponent(debouncedSearch.trim())}`
    : "/api/library";

  const { data, error, isLoading, mutate } = useSWR<LibraryData>(swrKey, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    // Hold the previous results while a new query is in flight, so the grid
    // does not blink through an empty state on every pause in typing.
    keepPreviousData: true,
  });

  const [pending, setPending] = useState<PendingClip[]>([]);
  // Read inside `clip` without making it depend on the render's value — a
  // callback that changed on every pending update would re-register the paste
  // listener mid-clip.
  const pendingRef = useRef<PendingClip[]>([]);
  pendingRef.current = pending; // eslint-disable-line react-hooks/refs -- kept in sync for the callback below

  const clip = useCallback(
    (pastedText: string) => {
      const url = parsePastedUrl(pastedText);
      if (!url) {
        toast.warning("That paste had no link in it");
        return;
      }
      if (pendingRef.current.some((p) => p.url === url)) return;

      const domain = new URL(url).hostname.replace(/^www\./, "");
      setPending((prev) => [...prev, { url, domain }]);

      fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
        .then(async (res) => {
          const body: ClipResponse = await res.json().catch(() => ({}) as ClipResponse);
          if (!res.ok) throw new Error(body.error || "Couldn't clip that link");
          return body;
        })
        .then((body) => {
          if (body.status === "duplicate") {
            toast.warning("That's already in your library");
            return;
          }

          // Prepend rather than revalidate: the response carries the article
          // the server just stored, and refetching would replace the whole
          // list, remounting every card and playing the entrance animation on
          // articles that have been sitting there for days.
          //
          // It lands at the front even when a search is narrowing the list and
          // the new clip does not match it. That is deliberate: the reader just
          // added this, and hiding it behind a filter they set before it
          // existed would look like the clip failed.
          mutate(
            (current) => ({ articles: [body.article, ...(current?.articles ?? [])] }),
            { revalidate: false }
          );

          if (body.status === "saved") {
            // Worth saying: nothing was fetched, and the article is now in two
            // places at once. Silence here would read as "it clipped a copy".
            toast.success("Saved from your feed — it stays there too");
          } else if (!body.article.clipped) {
            toast.warning("Saved the link — that page wouldn't give up its text");
          }
        })
        .catch((err: Error) => {
          console.error("[library] clip failed:", err);
          toast.danger(err.message);
        })
        .finally(() => {
          setPending((prev) => prev.filter((p) => p.url !== url));
        });
    },
    [mutate]
  );

  const removeArticle = useCallback(
    (slug: string) => {
      // `/api/library` rather than `/api/delete-article`: only the library
      // route knows that removing a saved feed article should unsave it and
      // leave the archive alone, while removing a pasted one deletes the row.
      return fetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then((body: { deleted: boolean }) => {
          mutate(
            (current) => ({
              articles: (current?.articles ?? []).filter((a) => a.slug !== slug),
            }),
            { revalidate: false }
          );
          toast.success(
            body.deleted ? "Deleted from your library" : "Removed — it's still in your feed"
          );
        })
        .catch((err) => {
          console.error("[library] delete failed:", err);
          toast.danger("Couldn't remove that — it's still in your library");
          throw err;
        });
    },
    [mutate]
  );

  return {
    articles: data?.articles ?? [],
    search,
    setSearch,
    /** True while a typed query has not yet reached the server. */
    searching: search.trim() !== debouncedSearch.trim(),
    loading: isLoading,
    error: error ? (error as Error).message : null,
    pending,
    clip,
    removeArticle,
  };
}
