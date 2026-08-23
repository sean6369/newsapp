"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ChatMessage, Conversation, ConversationSummary } from "@/lib/types";

/** Shared so the drawer's list and the page's saves address the same cache. */
const LIST_KEY = "/api/conversations";

interface ListData {
  conversations: ConversationSummary[];
}

const fetcher = async (url: string): Promise<ListData> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Couldn't load your past chats");
  return response.json();
};

/**
 * An id for a conversation the server has not heard of yet.
 *
 * Minted by the browser rather than returned by the first save, so the page
 * knows which chat it is holding before the network does — which is what lets
 * the save be one idempotent PUT instead of a create-then-update pair.
 *
 * `crypto.randomUUID` is only defined in a secure context, and this app is
 * also read over a plain LAN address, so the fallback is not theoretical — the
 * same constraint shapes the message ids in `useChat`. Both paths have to
 * produce a v4 UUID: the API route checks the shape before it reaches a
 * primary key.
 */
export function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * The reader's past Ask conversations, and the writes that change them.
 *
 * Mounted twice on the Ask page, deliberately. The page itself calls it with
 * `listWhen: false` because all it needs is `save`, while the drawer calls it
 * with its own open state, so the list is fetched when someone actually asks
 * to see it rather than on every visit to Ask. SWR's cache is what makes two
 * call sites safe: they share one entry under {@link LIST_KEY}, so a save from
 * the page invalidates the list the drawer is showing.
 */
export function useConversations({ listWhen = false }: { listWhen?: boolean } = {}) {
  const { mutate } = useSWRConfig();

  const { data, error, isLoading } = useSWR<ListData>(listWhen ? LIST_KEY : null, fetcher, {
    // The list changes only through this hook, and every one of those paths
    // invalidates it explicitly. Refetching on focus would reorder the drawer
    // under the reader's cursor for nothing.
    revalidateOnFocus: false,
    // Keep yesterday's list on screen while today's request is in flight, so
    // reopening the drawer does not blink through its empty state.
    keepPreviousData: true,
  });

  /**
   * Refetch the list now.
   *
   * The drawer calls this on every open, because its `listWhen` stays true
   * once it has been opened — the key cannot go back to null without emptying
   * the list mid-close — and a key that never changes is a key SWR has no
   * reason to refetch on its own.
   */
  const refresh = useCallback(() => {
    mutate(LIST_KEY);
  }, [mutate]);

  /**
   * Write a conversation, creating it on the first call for a given id.
   *
   * Fire-and-forget from the page's point of view: the answer is already on
   * screen, so a failed save costs history, not the conversation. It is
   * reported to the console and nowhere else — a toast on every failed save
   * would interrupt reading to describe a background chore.
   */
  const save = useCallback(
    async (id: string, messages: ChatMessage[]): Promise<ConversationSummary | null> => {
      try {
        const response = await fetch(`${LIST_KEY}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });

        if (!response.ok) throw new Error(`Save failed: ${response.status}`);

        const body: { conversation: ConversationSummary } = await response.json();
        // Revalidate rather than patch the cached array by hand: the server
        // decides both the title and the position, and re-sorting a local copy
        // to match is more code than one request the drawer is not waiting on.
        mutate(LIST_KEY);
        return body.conversation;
      } catch (err) {
        console.error("[conversations] save failed:", err);
        return null;
      }
    },
    [mutate]
  );

  /** The full thread for one chat. Throws, because the drawer shows the failure. */
  const open = useCallback(async (id: string): Promise<Conversation> => {
    const response = await fetch(`${LIST_KEY}/${id}`);
    if (!response.ok) throw new Error("Couldn't open that chat");

    const body: { conversation: Conversation } = await response.json();
    return body.conversation;
  }, []);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      // Optimistic, and without a revalidation to follow: the row is gone, the
      // reader watched it go, and a refetch would only be able to agree.
      mutate<ListData>(
        LIST_KEY,
        (current) => ({ conversations: (current?.conversations ?? []).filter((c) => c.id !== id) }),
        { revalidate: false }
      );

      const response = await fetch(`${LIST_KEY}/${id}`, { method: "DELETE" });

      if (!response.ok) {
        // Put it back by asking the server what is actually there, rather than
        // restoring a snapshot that may be older than a save made since.
        mutate(LIST_KEY);
        throw new Error("Couldn't delete that chat");
      }
    },
    [mutate]
  );

  return {
    conversations: data?.conversations ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    save,
    open,
    remove,
    refresh,
  };
}
