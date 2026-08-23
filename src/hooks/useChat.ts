"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AskStep, ChatMessage, RetrievedArticle } from "@/lib/types";

interface UseChatOptions {
  /** Where to POST. `/api/chat` for one article, `/api/ask` for the archive. */
  endpoint: string;
  /** Extra fields merged into the request body alongside `messages`. */
  body?: Record<string, unknown>;
  /** Restores a prior conversation, e.g. from sessionStorage. */
  initialMessages?: ChatMessage[];
  /**
   * A reply that finished after the reader had already moved on.
   *
   * Called with whatever `context` was handed to `sendMessage`, so the caller
   * can store the thread against the right conversation — and called for
   * *every* detached reply, including one that failed, where the thread is
   * null because there is nothing worth keeping.
   *
   * Firing on failure too is what keeps the caller's bookkeeping honest. A
   * page tracking which conversations are still being answered has no other
   * way to learn that one has stopped, and would otherwise show a reply as
   * arriving forever. Only a reply the caller discarded outright is silent.
   */
  onBackgroundFinish?: (messages: ChatMessage[] | null, context: string) => void;
}

interface UseChatReturn {
  messages: ChatMessage[];
  /**
   * `context` travels with this one reply and comes back through
   * `onBackgroundFinish` if it outlives the thread on screen. It has to ride
   * with the request rather than being read from a ref at the end, because by
   * then the reader may have started a second reply elsewhere.
   */
  sendMessage: (text: string, context?: string) => void;
  isStreaming: boolean;
  isSearching: boolean;
  error: string | null;
  /**
   * Empty the thread and abort any reply still arriving, keeping nothing.
   *
   * The counterpart to `replaceMessages`: this one throws the reply away. Used
   * where there is nowhere for a background reply to land, or where letting it
   * land would be wrong — deleting the conversation it belongs to.
   */
  clearMessages: () => void;
  /**
   * Swap in a saved thread. Anything still streaming is *detached*, not
   * cancelled — it finishes in the background and is handed to
   * `onBackgroundFinish`.
   *
   * Returns whether a reply was actually detached. The caller cannot work this
   * out for itself: its own `isStreaming` is a snapshot from the last render,
   * and a reply that completed since is one this reports as false and that
   * would report as true.
   */
  replaceMessages: (messages: ChatMessage[]) => boolean;
}

/**
 * The one thing a running reply and the rest of the hook still share.
 *
 * An object rather than a boolean ref because two replies can be in flight at
 * once: one detached and still writing, one the reader started afterwards. A
 * shared ref would let the second reply's arrival flip a flag the first is
 * reading. Each reply holds its own handle and nobody else's.
 */
interface StreamHandle {
  detached: boolean;
}

// Smooth token release: characters queue up and drip out at a steady rate
// instead of arriving in bursts. Adapts speed based on queue depth.
const BASE_CHARS_PER_FRAME = 1;
const MAX_CHARS_PER_FRAME = 12;
const QUEUE_PRESSURE_THRESHOLD = 100; // chars in queue before speeding up

/**
 * Message ids, unique against threads this page did not write.
 *
 * The counter alone is not enough once conversations can be reopened. It
 * restarts at zero on every page load, so a restored thread carrying `msg-1`
 * and `msg-2` would collide with the first question asked after it — two React
 * keys with the same value, which renders as the new message overwriting the
 * old one rather than appearing below it. Switching between two saved chats in
 * a single session makes the same collision certain.
 *
 * The per-load prefix fixes it without a lookup: ids minted now cannot match
 * ids minted by any other load, whatever the counter is doing. `randomUUID` is
 * avoided deliberately — it is unavailable outside a secure context, which is
 * exactly where this app is read over a plain LAN address.
 */
const ID_PREFIX = Math.random().toString(36).slice(2, 8);
let msgIdCounter = 0;
const nextMsgId = () => `msg-${ID_PREFIX}-${++msgIdCounter}`;

export function useChat({
  endpoint,
  body,
  initialMessages,
  onBackgroundFinish,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** The reply currently being watched, if any. Detached replies let go of this. */
  const activeStreamRef = useRef<StreamHandle | null>(null);

  // Held in a ref so a caller passing an object literal — the normal way to
  // write `body={{ slug }}` — does not give `sendMessage` a new identity on
  // every render.
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  });

  // Same reason as `bodyRef`: read at the end of a reply rather than captured
  // when it started, so a caller redefining the handler each render does not
  // give `sendMessage` a new identity.
  const onBackgroundFinishRef = useRef(onBackgroundFinish);
  useEffect(() => {
    onBackgroundFinishRef.current = onBackgroundFinish;
  });

  // Token queue refs
  const queueRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const doneStreamingRef = useRef(false);

  const flushQueueRef = useRef<() => void>(null!);

  const flushQueue = useCallback(() => {
    rafRef.current = null;

    if (queueRef.current.length === 0) {
      // Nothing left to drain — if stream is done, finalize
      if (doneStreamingRef.current) return;
      // Otherwise keep polling for new tokens
      rafRef.current = requestAnimationFrame(flushQueueRef.current);
      return;
    }

    // Adaptive rate: speed up when queue is deep to avoid falling behind
    const queueLen = queueRef.current.length;
    const pressure = Math.min(queueLen / QUEUE_PRESSURE_THRESHOLD, 1);
    const charsThisFrame = Math.round(
      BASE_CHARS_PER_FRAME + pressure * (MAX_CHARS_PER_FRAME - BASE_CHARS_PER_FRAME)
    );

    const count = Math.min(charsThisFrame, queueLen);

    const chunk = queueRef.current.slice(0, count);
    queueRef.current = queueRef.current.slice(count);

    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      // Optional chaining because the thread underneath can now be replaced or
      // emptied while a frame is still queued.
      if (last?.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          content: last.content + chunk,
        };
      }
      return updated;
    });

    // Keep draining if there's more, or if stream is still open
    if (queueRef.current.length > 0 || !doneStreamingRef.current) {
      rafRef.current = requestAnimationFrame(flushQueueRef.current);
    }
  }, []);

  flushQueueRef.current = flushQueue; // eslint-disable-line react-hooks/refs -- ref enables recursive requestAnimationFrame without circular const reference

  const enqueueTokens = useCallback(
    (text: string) => {
      queueRef.current += text;
      // Start the drain loop if not already running
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushQueue);
      }
    },
    [flushQueue]
  );

  /** Merges fields into the in-flight assistant message, which is always last. */
  const appendToAssistant = useCallback(
    (update: (last: ChatMessage) => Partial<ChatMessage>) => {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role !== "assistant") return prev;
        updated[updated.length - 1] = { ...last, ...update(last) };
        return updated;
      });
    },
    []
  );

  // Wait for the queue to fully drain, then resolve
  const waitForDrain = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const check = () => {
        if (queueRef.current.length === 0) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, context?: string) => {
      if (isStreaming || !text.trim()) return;

      const userMessage: ChatMessage = { id: nextMsgId(), role: "user", content: text };
      const assistantMessage: ChatMessage = { id: nextMsgId(), role: "assistant", content: "" };

      /**
       * This reply's own state, held in closure rather than in refs.
       *
       * Everything here used to live on the hook, which was correct while a
       * reply could only ever be the one on screen. It no longer is: a detached
       * reply keeps writing while the reader starts another, and shared refs
       * would have the two overwrite each other's sources and token queues.
       *
       * It also gives a detached reply something to be assembled *from*. Once
       * the thread on screen has been swapped out, view state is a record of a
       * different conversation, so the finished message is built from these.
       */
      const stream: StreamHandle = { detached: false };
      activeStreamRef.current = stream;

      const priorMessages = messages;
      let fullText = "";
      let steps: AskStep[] = [];
      let articles: RetrievedArticle[] = [];
      let sources: ChatMessage["sources"];

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setError(null);
      queueRef.current = "";
      doneStreamingRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const allMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...bodyRef.current, messages: allMessages }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.searching && !stream.detached) {
                setIsSearching(true);
              }
              if (parsed.sources) {
                sources = parsed.sources;
              }
              // Retrieval steps and their articles bypass the token queue.
              // Both describe work already done rather than an answer being
              // typed out, but it is the steps that need it: they are all the
              // reader has to look at during the seconds before any text
              // arrives. The articles ride along and are held by `AskPage`
              // until the reply is complete, which is the earliest it can group
              // them by which ones the answer cited.
              //
              // Each of these accumulates locally first and is mirrored into
              // the view second. The local copy is the record; the view is the
              // performance of it, and a detached reply simply stops
              // performing.
              if (parsed.step) {
                steps = [...steps, parsed.step as AskStep];
                if (!stream.detached) {
                  setIsSearching(false);
                  appendToAssistant(() => ({ steps }));
                }
              }
              if (parsed.articles) {
                const seen = new Set(articles.map((a) => a.slug));
                const fresh = (parsed.articles as RetrievedArticle[]).filter(
                  (a) => !seen.has(a.slug)
                );
                if (fresh.length > 0) {
                  articles = [...articles, ...fresh];
                  if (!stream.detached) appendToAssistant(() => ({ articles }));
                }
              }
              if (parsed.text) {
                fullText += parsed.text;
                if (!stream.detached) {
                  setIsSearching(false);
                  // Only a watched reply is worth animating. A detached one
                  // has already taken the text above; putting it through the
                  // queue would drip it into somebody else's thread.
                  enqueueTokens(parsed.text);
                }
              }
              if (parsed.error && !stream.detached) {
                setError(parsed.error);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Unknown error";
        // A detached reply's failure belongs to a conversation the reader is no
        // longer looking at. Reporting it over the thread they *are* looking at
        // would blame the wrong question.
        if (!stream.detached) setError(message);
        else console.warn("[chat] Background reply failed:", message);
      } finally {
        /**
         * Whether the view still belongs to this reply.
         *
         * False once something has let go of it — `replaceMessages` detaching
         * it, or `clearMessages` aborting it — both of which already did their
         * own teardown and may since have handed the view to a reply the
         * reader started afterwards. Lowering `isStreaming` from here in that
         * case would unlock the composer underneath an answer still arriving.
         */
        const ownsView = activeStreamRef.current === stream;

        // Likewise only if they are still ours.
        if (abortRef.current === controller) abortRef.current = null;
        if (ownsView) activeStreamRef.current = null;

        if (stream.detached) {
          // Nothing on screen belongs to this reply any more, so none of the
          // view teardown below applies — no queue to drain, no streaming flag
          // to lower. It was lowered when the reader walked away.
          //
          // An empty reply is dropped rather than stored: a request that failed
          // or was cut off has nothing worth keeping, which is the same rule
          // the page applies to a reply it did watch.
          if (context) {
            onBackgroundFinishRef.current?.(
              // No text means a reply that failed or was cut off, which is not
              // worth storing — but the caller still has to hear that it ended.
              !fullText
                ? null
                : [
                    ...priorMessages,
                    userMessage,
                    {
                      ...assistantMessage,
                      content: fullText,
                    ...(steps.length > 0 ? { steps } : {}),
                    ...(articles.length > 0 ? { articles } : {}),
                    ...(sources ? { sources } : {}),
                  },
                ],
              context
            );
          }
          return;
        }

        // Aborted, and whatever aborted it has already torn the view down.
        if (!ownsView) return;

        // Signal the drain loop that no more tokens are coming
        doneStreamingRef.current = true;

        // Wait for the queue to fully drain before finalizing
        await waitForDrain();

        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        if (sources) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
              updated[updated.length - 1] = { ...last, sources };
            }
            return updated;
          });
        }
        setIsStreaming(false);
        setIsSearching(false);
      }
    },
    [endpoint, messages, isStreaming, enqueueTokens, waitForDrain, appendToAssistant]
  );

  /**
   * Put a different thread on screen, leaving the current reply to finish.
   *
   * The request is deliberately *not* aborted. An answer to a question the
   * reader asked is worth having whether or not they stayed to watch it
   * arrive, and this used to throw one away — along with the whole
   * conversation, when it was the first exchange and nothing had been saved
   * yet.
   *
   * What is torn down is only the performance: the token queue and the frame
   * draining it, which from here on would be typing into a conversation that
   * is not the one that asked. The reply keeps accumulating in its own closure
   * and is handed to `onBackgroundFinish` when it completes.
   *
   * `isStreaming` drops immediately, because it means "the thread on screen is
   * being answered" and that is no longer true of anything visible.
   */
  const replaceMessages = useCallback((next: ChatMessage[]): boolean => {
    const stream = activeStreamRef.current;
    const detached = stream !== null;
    if (stream) {
      stream.detached = true;
      activeStreamRef.current = null;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    queueRef.current = "";
    doneStreamingRef.current = true;
    setMessages(next);
    setError(null);
    setIsStreaming(false);
    setIsSearching(false);

    return detached;
  }, []);

  /**
   * Not `replaceMessages([])`, which is what this used to be.
   *
   * That one now lets the reply finish in the background, which is right when
   * the reader is moving to another conversation and wrong here. Clearing is
   * how a reply is *abandoned*: the article panel has no history for one to
   * land in, and on the Ask page this is what runs when the conversation being
   * answered has just been deleted — where finishing would recreate the row.
   */
  const clearMessages = useCallback(() => {
    const stream = activeStreamRef.current;
    if (stream) {
      // Cleared rather than detached, so the reply's finally hands nothing on.
      stream.detached = false;
      activeStreamRef.current = null;
    }

    abortRef.current?.abort();
    abortRef.current = null;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    queueRef.current = "";
    doneStreamingRef.current = true;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setIsSearching(false);
  }, []);

  return {
    messages,
    sendMessage,
    isStreaming,
    isSearching,
    error,
    clearMessages,
    replaceMessages,
  };
}
