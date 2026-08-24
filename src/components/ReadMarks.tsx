"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { toast } from "@heroui/react";
import { READ_MARKS_ENDPOINT } from "@/lib/read-marks";

interface ReadMarks {
  /** Whether the feature is switched on. Hides the context menu's toggle. */
  enabled: boolean;
  /** Called by a card as it is clicked through to. A no-op when switched off. */
  markRead: (slug: string) => void;
  /** Put one article back to unread. */
  markUnread: (slug: string) => void;
  /** Throw the switch. Turning it off forgets every mark. */
  setEnabled: (on: boolean) => Promise<void>;
}

/* -------------------------------------------------------------------------
 * The session's changes
 *
 * Module scope rather than component state, and that is load-bearing: the
 * router keeps a cache of pages it has already rendered, so navigating back
 * out of an article restores the feed's markup *as it was before the article
 * was opened* — with the card still saying unread. React state in the provider
 * would have been thrown away with the unmounted page, leaving the reader
 * looking at the one card they know they just read, undimmed.
 *
 * Holding it here costs nothing: it is one entry per card actually clicked,
 * not per article ever read, and a full page load starts it empty again —
 * which is exactly when the server's own flags are fresh enough to stand on
 * their own.
 *
 * Only ever written from event handlers, so it stays empty on the server,
 * where a mutable module would otherwise be shared between requests.
 * ------------------------------------------------------------------------- */

interface Session {
  /** What this session has changed, by slug. */
  overrides: ReadonlyMap<string, boolean>;
  /**
   * Set once the switch has been thrown, after which the `read` flags baked
   * into any already-rendered page describe a table that no longer exists —
   * switching off empties it. Until fresh rows arrive, only the overrides are
   * believed, which is right in both directions: off means nothing is read,
   * and back on means starting from nothing. Cleared by `noteServerFresh`.
   */
  serverStale: boolean;
  /** The reader's own move on the switch, outranking what the page was rendered with. */
  enabled: boolean | null;
}

const EMPTY_SESSION: Session = { overrides: new Map(), serverStale: false, enabled: null };

let session: Session = EMPTY_SESSION;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(next: Session) {
  session = next;
  for (const listener of listeners) listener();
}

/**
 * The switch alone, as a primitive.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is`, so handing back
 * a boolean means a subscriber only re-renders when the switch actually moves
 * — not every time a mark does.
 */
function getEnabled(): boolean | null {
  return session.enabled;
}

function getServerEnabled(): boolean | null {
  return null;
}

/**
 * The same store, but a listener is only woken when the switch moves.
 *
 * Marks move far more often than the switch does, and the provider cares only
 * about the switch.
 */
function subscribeEnabled(listener: () => void): () => void {
  let last = session.enabled;
  return subscribe(() => {
    if (session.enabled === last) return;
    last = session.enabled;
    listener();
  });
}

/**
 * Called when a fresh page of articles lands from the server.
 *
 * Clears `serverStale`: the flags on those rows were read after the switch was
 * thrown, so they describe the table as it is now and can be believed again.
 * Without this, throwing the switch would make this session ignore its own
 * server for good — including marks another device made, which is the thing
 * revalidating on focus exists to pick up.
 *
 * The overrides are left alone. They are this reader's own most recent word on
 * those few slugs, and a fetch that started before one of them landed would
 * otherwise undo it.
 */
export function noteServerFresh() {
  if (!session.serverStale) return;
  update({ ...session, serverStale: false });
}

function setOverride(slug: string, read: boolean | undefined) {
  const overrides = new Map(session.overrides);
  if (read === undefined) overrides.delete(slug);
  else overrides.set(slug, read);
  update({ ...session, overrides });
}

const ReadMarksContext = createContext<ReadMarks>({
  enabled: false,
  markRead: () => {},
  markUnread: () => {},
  setEnabled: async () => {},
});

export function useReadMarks(): ReadMarks {
  return useContext(ReadMarksContext);
}

/**
 * Whether one article counts as read: the row's own flag as the server
 * rendered it, with this session's changes over the top.
 *
 * Subscribed per slug rather than read from context, so marking a card
 * re-renders that card and nothing else. Returns a boolean, which
 * `useSyncExternalStore` compares by value — a card whose answer has not
 * changed is never re-rendered, however many marks move around it.
 */
export function useReadState(slug: string, serverRead: boolean): boolean {
  const { enabled } = useReadMarks();
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!enabled) return false;
      const override = session.overrides.get(slug);
      // `??` is right here: an override of `false` is an answer, not an absence.
      return override ?? (session.serverStale ? false : serverRead);
    },
    // Nothing has been changed yet on the server, and hydration must agree.
    () => (enabled ? serverRead : false)
  );
}

/**
 * Read marks for one page.
 *
 * There is no cache of marks here and nothing to fetch. Articles arrive from
 * the server already knowing whether they have been read — the flag is on the
 * row — so all this carries is the difference the reader has made since, which
 * is bounded by how many cards they have clicked rather than by how much they
 * have ever read.
 *
 * Writes are optimistic: the card dims on the click, not on the round trip. A
 * failure drops that slug's override and it falls straight back to what the
 * server said, so there is no rollback bookkeeping and no way for two writes
 * to interfere — they touch different keys.
 */
export function ReadMarksProvider({
  enabled: renderedEnabled,
  children,
}: {
  /** The switch as the server rendered this page. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  // Only the switch, not the overrides. A mark moving must not re-render this
  // provider: its context value would be rebuilt, every card under it would be
  // told to re-render, and marking one card in a full day's feed would cost a
  // re-render of all two hundred. Cards watch their own slug instead — see
  // `useReadState`.
  const chosenEnabled = useSyncExternalStore(subscribeEnabled, getEnabled, getServerEnabled);
  const enabled = chosenEnabled ?? renderedEnabled;

  const write = useCallback((slug: string, read: boolean) => {
    setOverride(slug, read);
    fetch(READ_MARKS_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, read }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that");
      })
      .catch((err: Error) => {
        console.error("[read-marks] write failed:", err);
        // Dropping the override is the whole of the undo: the card goes back to
        // whatever the server rendered it as.
        setOverride(slug, undefined);
        // A transport failure arrives as a TypeError carrying the browser's own
        // wording — "Failed to fetch", "Load failed" — which says nothing about
        // what happened to the card. Only the server's own message is worth
        // repeating verbatim.
        toast.danger(
          err instanceof TypeError
            ? "Couldn't reach the server — that stayed as it was"
            : err.message
        );
      });
  }, []);

  const markRead = useCallback(
    (slug: string) => {
      if (!enabled) return;
      write(slug, true);
    },
    [enabled, write]
  );

  const markUnread = useCallback((slug: string) => write(slug, false), [write]);

  const setEnabled = useCallback(async (on: boolean) => {
    // Moves with the click, along with everything it implies for the cards
    // behind this page — waiting for the round trip would show a switch that
    // had moved above a feed that had not.
    update({ overrides: new Map(), serverStale: true, enabled: on });
    try {
      const response = await fetch(READ_MARKS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: on }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that");
      }
    } catch (err) {
      // Put the switch back, but leave `serverStale` set: the request may have
      // cleared the table before failing, so the flags already on screen cannot
      // be trusted either way until the next full load.
      update({ overrides: new Map(), serverStale: true, enabled: !on });
      throw err;
    }
  }, []);

  const value = useMemo(
    () => ({ enabled, markRead, markUnread, setEnabled }),
    [enabled, markRead, markUnread, setEnabled]
  );

  return <ReadMarksContext value={value}>{children}</ReadMarksContext>;
}
