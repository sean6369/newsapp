"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@heroui/react/button";
import { Kbd } from "@heroui/react/kbd";
import { Plus, X } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";
import { LibraryGrid } from "@/components/LibraryGrid";
import { SearchInput, ViewToggle } from "@/components/FeedFilter";
import type { ViewMode } from "@/components/ArticleGrid";
import { LIBRARY_VIEW_COOKIE, setViewCookie } from "@/lib/view-cookie";

/** The box growing from button to field. Springy enough to feel physical. */
const EXPAND_TRANSITION = { type: "spring", duration: 0.4, bounce: 0.15 } as const;

/** Content cross-fade, short enough to finish inside the expansion. */
const SWAP_TRANSITION = { duration: 0.15 } as const;

/** No keyboard ever changes under us, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};

/**
 * Whether this reader is on a Mac, and so which modifier to name.
 *
 * `useSyncExternalStore` rather than an effect, because the two renders
 * genuinely disagree: the server has no keyboard to ask and must print
 * something, and this is the hook that lets it assume a Mac and be corrected on
 * the client without the markup mismatching in between.
 */
function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => true
  );
}

/**
 * The paste shortcut, as a real key cap.
 *
 * `Kbd.Abbr` is what earns the component here over a styled `<kbd>`: it puts
 * the glyph in an `<abbr title="Command">`, so `⌘` is announced as a key
 * instead of read out as whatever a screen reader makes of the bare character.
 *
 * Only the Mac branch uses it. HeroUI maps `ctrl` to `⌃`, which is the Mac
 * control glyph — no Windows or Linux keyboard has that written on it, and the
 * accessible name would be right while the thing on screen was wrong.
 *
 * `variant="light"` drops the cap's background, which the Add button needs:
 * HeroUI resolves `--color-default` to `--default`, so the default cap and a
 * ghost button's hover fill are the same colour and the hint would disappear
 * under the cursor.
 */
function PasteShortcut({
  className,
  variant,
}: {
  className?: string;
  variant?: "default" | "light";
}) {
  const isMac = useIsMac();

  return (
    <Kbd className={className} variant={variant}>
      {isMac ? <Kbd.Abbr keyValue="command" /> : <Kbd.Content>Ctrl</Kbd.Content>}
      <Kbd.Content>V</Kbd.Content>
    </Kbd>
  );
}

export function LibraryPage({ initialView = "grid" }: { initialView?: ViewMode }) {
  const { articles, search, setSearch, loading, error, pending, clip, removeArticle } =
    useLibrary();
  const [view, setView] = useState<ViewMode>(initialView);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening the field and not focusing it would leave the reader with a text
  // box they still have to click.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /**
   * Clip whatever is pasted onto the page, wherever the cursor happens to be.
   *
   * On `window` rather than on a field, because the field is the fallback: the
   * gesture this page is built around is landing on it and hitting paste, with
   * nothing focused and nothing clicked.
   *
   * Pastes aimed at a real input are left entirely alone. Once the reader has
   * opened the field they have said they want to work on the text — check it,
   * fix a truncated URL, paste a second time over the first — so the paste
   * belongs to the box and the clip waits for Enter. Firing the moment the
   * text landed would make the field impossible to correct in.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;

      event.preventDefault();
      clip(text);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [clip]);

  const collapse = () => {
    setOpen(false);
    setDraft("");
  };

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    clip(text);
    // Back to the button: the clip is on its way and the card it becomes is
    // the thing to look at now, not an empty field.
    collapse();
  };

  const handleViewChange = (selected: ViewMode) => {
    setView(selected);
    setViewCookie(LIBRARY_VIEW_COOKIE, selected);
  };

  const searching = search.trim().length > 0;
  const isEmpty = !loading && articles.length === 0 && pending.length === 0;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="font-serif text-2xl md:text-3xl font-medium shrink-0">Library</h1>

        {/* One box that grows, rather than a button that is replaced by a field:
            `layout` measures both states and tweens the border between them, so
            the dashed outline is continuous through the expansion. The contents
            cross-fade inside it — `popLayout` takes the outgoing child out of
            flow so the incoming one lays out at once and the box can resize
            around it, instead of the two waiting on each other.

            Open, it takes the rest of the header row rather than the page
            width: the title is the other half of this row, and a field that
            grew past it would have to push it off screen. */}
        <motion.div
          layout
          transition={EXPAND_TRANSITION}
          className={`flex items-center overflow-hidden border-2 border-dashed border-border rounded-lg transition-colors hover:border-accent/40 focus-within:border-accent/60 ${
            open ? "flex-1" : "w-fit"
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {open ? (
              <motion.div
                key="field"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SWAP_TRANSITION}
                className="flex items-center gap-3 w-full px-4 py-2"
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitDraft();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      collapse();
                    }
                  }}
                  onBlur={() => {
                    // Only when there is nothing to lose. Collapsing a field
                    // with a half-typed URL in it because the reader clicked
                    // away would throw their work out.
                    if (!draft.trim()) setOpen(false);
                  }}
                  placeholder="Paste a link, then press Enter"
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted"
                  aria-label="Article link to clip"
                />
                <button
                  type="button"
                  onClick={collapse}
                  className="shrink-0 p-1 rounded-md text-muted hover:text-foreground hover:bg-accent/10 transition-colors cursor-pointer"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="add"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SWAP_TRANSITION}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-lg gap-1.5"
                  onPress={() => setOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add
                  {/* The hint belongs on the resting state, where the shortcut
                      is live. Inside the field ⌘V is an ordinary paste, so
                      showing it there would advertise a behaviour that no
                      longer holds. */}
                  <PasteShortcut variant="light" className="ml-0.5 px-0 text-xs" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Count on the left, controls on the right — the home feed's toolbar
          shape, with the filter and sort it has no use for left out. */}
      <div className="flex items-center justify-between gap-2 mb-6">
        <span className="text-xs text-muted shrink-0 max-md:sr-only">
          {articles.length} {articles.length === 1 ? "article" : "articles"}
          {searching && " found"}
        </span>
        <div className="flex items-center gap-3 max-md:flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search your library..."
            aria-label="Search your library"
          />
          <ViewToggle view={view} onViewChange={handleViewChange} />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {isEmpty ? (
        <div className="text-center py-16">
          {searching ? (
            <>
              <p className="font-serif text-lg mb-2">Nothing matches that</p>
              <p className="text-sm text-muted max-w-sm mx-auto">
                Searching titles, summaries, the article text, and where it came from.
              </p>
            </>
          ) : (
            <>
              <p className="font-serif text-lg mb-2">Nothing clipped yet</p>
              <p className="text-sm text-muted max-w-sm mx-auto">
                Press <PasteShortcut className="mx-0.5 align-middle" /> anywhere on this page to
                paste a link. Whatever you keep here stays here — clips never join the feed.
              </p>
            </>
          )}
        </div>
      ) : (
        <LibraryGrid
          articles={articles}
          pending={pending}
          loading={loading}
          view={view}
          onRemove={removeArticle}
        />
      )}
    </div>
  );
}
