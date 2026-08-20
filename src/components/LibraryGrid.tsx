"use client";

import { useCallback } from "react";
import { motion } from "motion/react";
import { LIBRARY_FEED, type Article } from "@/lib/types";
import type { PendingClip } from "@/hooks/useLibrary";
import { ClippingCard, ClippingRow, LibraryCard, LibraryRow } from "./LibraryCard";
import { ArticleContextMenu } from "./ArticleContextMenu";
import { LoadingCard, LoadingRow } from "./LoadingCard";
import type { ViewMode } from "./ArticleGrid";
import { useFlipAnimation } from "./useFlipAnimation";
import {
  ENTRANCE_LIMIT,
  entranceAnimate,
  entranceInitial,
  entranceTransition,
} from "./article-shared";

interface LibraryGridProps {
  articles: Article[];
  pending: PendingClip[];
  loading: boolean;
  view?: ViewMode;
  /** Takes it out of the library — which deletes a pasted page but only
   *  unsaves a feed article. See the DELETE handler in `/api/library`. */
  onRemove: (slug: string) => Promise<void>;
}

/**
 * The library's cards, animated the way the feed's are.
 *
 * Same two motions, from the same constants, for the same reasons: cards that
 * survive a change slide to their new positions (`useFlipAnimation`), and cards
 * that appear rise and fade in (`entrance*`).
 *
 * The feed needs a generation counter to decide between the two because a
 * refetch can replace every row at once. Here the list only ever changes one
 * card at a time and the keys carry the slug, so mounting *is* the signal:
 * React reuses the element of every article that was already on screen, which
 * leaves the entrance to run on exactly the cards that just appeared. A paste
 * shifts the grid down a slot under the placeholder, the finished card fades
 * into that slot, and a delete slides the survivors back up.
 */
export function LibraryGrid({
  articles,
  pending,
  loading,
  view = "grid",
  onRemove,
}: LibraryGridProps) {
  const isList = view === "list";

  const setCardRef = useFlipAnimation({
    enabled: true,
    // `view` is a layout input like the others: switching it moves every card,
    // and without it here the grid would jump between layouts instead of
    // sliding into the new one.
    deps: [articles, pending, view],
  });

  const handleRemove = useCallback(
    (slug: string) => {
      onRemove(slug).catch(() => {});
    },
    [onRemove]
  );

  const layoutClass = isList
    ? "flex flex-col gap-2"
    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";

  if (loading) {
    return (
      <div className={layoutClass}>
        {Array.from({ length: 3 }).map((_, i) =>
          isList ? <LoadingRow key={i} /> : <LoadingCard key={i} />
        )}
      </div>
    );
  }

  return (
    <div className={layoutClass}>
      {pending.map((clip) => (
        <motion.div
          key={clip.url}
          initial={entranceInitial}
          animate={entranceAnimate}
          transition={entranceTransition(0)}
        >
          {isList ? <ClippingRow clip={clip} /> : <ClippingCard clip={clip} />}
        </motion.div>
      ))}

      {articles.map((article, i) => (
        <motion.div
          // Keyed by view as well as slug, so switching layout remounts every
          // card. That is what divides the two motions here: a card that
          // survives a render slides (FLIP), a card that mounts rises and
          // fades. Sliding a 220px card into a 70px row and back is not a
          // movement worth animating, so the view switch takes the entrance
          // instead — the same call `ArticleGrid` makes with its generation
          // counter.
          key={`${article.slug}-${view}`}
          ref={(el) => setCardRef(article.slug, el)}
          initial={i < ENTRANCE_LIMIT ? entranceInitial : false}
          animate={entranceAnimate}
          transition={entranceTransition(i)}
        >
          <ArticleContextMenu
            slug={article.slug}
            sourceUrl={article.sourceUrl}
            sourceDomain={article.sourceDomain}
            title={article.title}
            onDelete={handleRemove}
            // A pasted page exists only because it was saved, so removing it
            // really is a delete. A feed article was here first and stays.
            deleteLabel={
              article.feed === LIBRARY_FEED ? "Delete" : "Remove from library"
            }
          >
            {(menuTrigger) =>
              isList ? (
                <LibraryRow article={article} menuTrigger={menuTrigger} />
              ) : (
                <LibraryCard article={article} menuTrigger={menuTrigger} />
              )
            }
          </ArticleContextMenu>
        </motion.div>
      ))}
    </div>
  );
}
