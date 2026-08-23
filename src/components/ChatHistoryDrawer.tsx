"use client";

import { useState } from "react";
import { Drawer, toast, useOverlayState } from "@heroui/react";
import { History, LoaderCircle, Trash2 } from "lucide-react";
import { useConversations } from "@/hooks/useConversations";
import type { Conversation } from "@/lib/types";

/** A conversation the table has not caught up with yet. */
export interface PendingChat {
  id: string;
  /** Its opening question, truncated the way the server would name it. */
  title: string;
  /** What it is waiting on — "Answering…" or "Saving…". */
  label: string;
}

interface ChatHistoryDrawerProps {
  /** The chat on screen, so the list can show where you already are. */
  activeId: string | null;
  /**
   * Chats in flight: the one on screen before its first save, and any left
   * answering in the background. Entries already present in the list are
   * ignored — a saved conversation is shown by its real row.
   */
  pending: PendingChat[];
  /**
   * Conversations being answered off-screen.
   *
   * They can be opened — the thread arrives as it was last saved, and the page
   * drops the finished reply into it when it lands. What they cannot be is
   * deleted: the reply is still coming, and saving it would write the row
   * straight back a moment after the reader asked for it to go.
   */
  busyIds: string[];
  /**
   * Styling for the trigger, which lives in whatever chrome the page gives it.
   * The component owns the button because it owns the drawer's open state; it
   * has no business deciding what the surrounding header looks like.
   */
  triggerClassName?: string;
  onSelect: (conversation: Conversation) => void;
  /** Called when the chat currently on screen is deleted out from under it. */
  onActiveDeleted: () => void;
}

/**
 * Past conversations, in a drawer off the side of the Ask page.
 *
 * A drawer rather than a page or a permanent sidebar. History is somewhere you
 * go to fetch one thing and leave: a page would cost a navigation away from a
 * conversation that is still on screen, and a sidebar would spend a fifth of
 * every visit to Ask on a list nobody had asked to see. The panel is also the
 * only part of Ask that is ever more than one column wide, which is why it
 * comes in from the edge instead of over the middle of the thread.
 *
 * The component owns its own open state and its own trigger, so the page it
 * sits on knows only about the chat that comes back out of it.
 */
export function ChatHistoryDrawer({
  activeId,
  pending,
  busyIds,
  triggerClassName,
  onSelect,
  onActiveDeleted,
}: ChatHistoryDrawerProps) {
  /**
   * Whether history has been asked for at all this visit.
   *
   * Sticky rather than simply mirroring `state.isOpen`, and that is the point.
   * The list is not fetched until someone opens the drawer — Ask is a page
   * people come to in order to ask something, and most visits never look at
   * history — but it must not be *dropped* when they close it: the panel spends
   * a couple of hundred milliseconds sliding out, and a list that emptied on
   * the way would flash "Nothing here yet" at someone who has just chosen a
   * chat. Keeping the key alive keeps the rows on screen for the exit.
   */
  const [hasOpened, setHasOpened] = useState(false);

  const { conversations, loading, error, open, remove, refresh } = useConversations({
    listWhen: hasOpened,
  });

  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (!isOpen) return;
      // Every open is a fresh look. The key stops changing after the first one,
      // so nothing else would prompt SWR to go and ask again.
      setHasOpened(true);
      refresh();
    },
  });

  /** The row waiting on its thread. Only ever one — the drawer closes on arrival. */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);

  /**
   * Whether the chat on screen is one the list cannot show yet.
   *
   * Derived from the list rather than from `isStreaming`, because the gap is
   * wider than the answer: nothing is written until the reply completes, and
   * the save that follows spends a couple of seconds having the conversation
   * named. Asking "is it in the list" covers both, and closes by itself the
   * moment the real row arrives.
   *
   * Held back while the first fetch is in flight. During that window the list
   * is empty because nothing has loaded, not because the chat is new, and a
   * saved conversation would otherwise appear twice — once as itself a moment
   * later, and once here.
   */
  const pendingRows = loading
    ? []
    : pending.filter((p) => !conversations.some((c) => c.id === p.id));

  const handleSelect = async (id: string) => {
    // The chat already on screen. Closing is the whole of the right answer:
    // refetching it would replace the thread with an identical one and throw
    // away the scroll position the reader was holding.
    if (id === activeId) {
      state.close();
      return;
    }

    setOpeningId(id);
    try {
      onSelect(await open(id));
      state.close();
    } catch (err) {
      console.error("[conversations] open failed:", err);
      toast.danger("Couldn't open that chat");
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingIds((ids) => [...ids, id]);
    try {
      await remove(id);
      // Only after the server agrees. Clearing the page first would leave the
      // reader with an empty Ask page and a chat that still exists.
      if (id === activeId) onActiveDeleted();
    } catch (err) {
      console.error("[conversations] delete failed:", err);
      toast.danger("Couldn't delete that chat");
    } finally {
      setDeletingIds((ids) => ids.filter((pendingId) => pendingId !== id));
    }
  };

  return (
    <Drawer.Root state={state}>
      <Drawer.Trigger className={triggerClassName}>
        <History className="h-[18px] w-[18px]" aria-hidden />
        {/* The name survives losing the label. `sr-only` text rather than an
            `aria-label` because it is real content that happens to be
            invisible — if the button ever shows its word again, this is
            already right, where an `aria-label` would silently disagree. */}
        <span className="sr-only">History</span>
      </Drawer.Trigger>

      <Drawer.Backdrop variant="blur">
        <Drawer.Content placement="right">
          {/* No background of its own: HeroUI's overlay surface is what the
              share and download modals already sit on, and a drawer that
              painted itself would be the one overlay in the app that did. */}
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading className="font-serif text-lg">Past chats</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>

            <Drawer.Body>
              {loading && conversations.length === 0 && (
                <p className="py-8 text-center text-sm text-muted">Loading…</p>
              )}

              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
              )}

              {!loading && !error && pendingRows.length === 0 && conversations.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-sm text-muted">Nothing here yet.</p>
                  <p className="mt-1 text-xs text-muted">
                    Chats are kept once they have an answer.
                  </p>
                </div>
              )}

              {/* No negative margin, however tempting.
                  
                  Pulling the rows out into the dialog's padding makes their
                  fill reach nearer the panel edge, but this is the scroll
                  container: `drawer__body` sets `overflow-y: auto`, and CSS
                  will not leave the other axis `visible` when one axis
                  scrolls, so anything wider than the body turns into a
                  horizontal scrollbar. The dialog's own `p-6` cannot be
                  overridden from here either — HeroUI applies it through an
                  unlayered rule, which outranks any Tailwind utility.
                  
                  So the rows sit inside the body and carry their own padding.
                  The pills are inset from the panel edge rather than bleeding
                  towards it, and the section headings line up with the row
                  text they label rather than with the panel's title. */}
              <div className="space-y-5">
                {/* The one heading left in the drawer, and not a date: it
                    separates what is still being written from what is stored.
                    Without it a chat with no answer yet would sit in the list
                    looking like any other. */}
                {pendingRows.length > 0 && (
                  <section>
                    <h3 className="px-3 pb-1.5 text-xs font-medium tracking-wide text-muted">
                      Now
                    </h3>
                    <ul>
                      {pendingRows.map((row) => {
                        // The accent says "you are here", exactly as it does in
                        // the list below — never "this one is busy". Only one
                        // row in the whole drawer can carry it, and a
                        // conversation answering in the background is somewhere
                        // the reader is precisely *not*.
                        const isActive = row.id === activeId;

                        return (
                          /* Not buttons. One of these may be where the reader
                             already is; the rest are being written and have
                             nothing yet to open. Both end the same way — the
                             row joining the list below under a written title. */
                          <li
                            key={row.id}
                            className={`rounded-full px-3 py-2 ${isActive ? "bg-accent-light" : ""}`}
                          >
                            <span
                              className={`line-clamp-2 text-sm ${
                                isActive ? "text-accent" : "text-foreground"
                              }`}
                            >
                              {row.title}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">{row.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {conversations.length > 0 && (
                  <ul>
                    {conversations.map((conversation) => {
                        const isActive = conversation.id === activeId;
                        const isOpening = conversation.id === openingId;
                        const isDeleting = deletingIds.includes(conversation.id);
                        const isBusy = busyIds.includes(conversation.id);

                        return (
                          // `group/row` rather than a bare `group`: the delete
                          // button reacts to its own hover as well as the
                          // row's, and unnamed groups would have the inner
                          // state shadowed by the outer one.
                          <li
                            key={conversation.id}
                            className={`group/row relative rounded-full transition-colors ${
                              isActive ? "bg-accent-light" : "hover:bg-border/50"
                            } ${isDeleting ? "pointer-events-none opacity-40" : ""}`}
                          >
                            {/* Padded on the right for the delete button that
                                sits over it, so a long title wraps before it
                                reaches one rather than under it. */}
                            <button
                              onClick={() => handleSelect(conversation.id)}
                              disabled={isOpening || isDeleting}
                              aria-current={isActive ? "true" : undefined}
                              className="w-full cursor-pointer px-3 py-2 pr-10 text-left"
                            >
                              <span
                                className={`line-clamp-2 text-sm ${
                                  isActive ? "text-accent" : "text-foreground"
                                }`}
                              >
                                {conversation.title}
                              </span>
                              {/* Only when there is something to say. The
                                  titles carry the whole list now — a second
                                  line under every row that merely restated the
                                  heading above it was repeating the grouping
                                  rather than adding to it. */}
                              {isBusy && (
                                <span className="mt-0.5 block text-xs text-muted">Answering…</span>
                              )}
                            </button>

                            {isOpening || isBusy ? (
                              /* Stands in for the delete button while a reply
                                 is still arriving: deleting the row now would
                                 only have that reply write it straight back. */
                              <LoaderCircle
                                className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-muted"
                                aria-hidden
                              />
                            ) : (
                              /* Revealed on hover on a mouse, always present on
                                 touch — there is no hover to reveal it with, and
                                 a control you cannot reach is worse than a
                                 control that is always visible. */
                              <button
                                onClick={() => handleDelete(conversation.id)}
                                disabled={isDeleting}
                                aria-label={`Delete "${conversation.title}"`}
                                className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-muted opacity-100 transition-[color,opacity] hover:text-red-600 focus-visible:opacity-100 md:opacity-0 md:group-hover/row:opacity-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            )}
                          </li>
                        );
                    })}
                  </ul>
                )}
              </div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}
