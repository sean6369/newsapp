"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/lib/types";

interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (text: string) => void;
  isStreaming: boolean;
  isSearching: boolean;
  error: string | null;
  clearMessages: () => void;
}

// Smooth token release: characters queue up and drip out at a steady rate
// instead of arriving in bursts. Adapts speed based on queue depth.
const BASE_CHARS_PER_FRAME = 1;
const MAX_CHARS_PER_FRAME = 12;
const QUEUE_PRESSURE_THRESHOLD = 100; // chars in queue before speeding up

let msgIdCounter = 0;
const nextMsgId = () => `msg-${++msgIdCounter}`;

export function useChat(identifier: string): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSourcesRef = useRef<ChatMessage["sources"]>(undefined);

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
      if (last.role === "assistant") {
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
    async (text: string) => {
      if (isStreaming || !text.trim()) return;

      const userMessage: ChatMessage = { id: nextMsgId(), role: "user", content: text };
      const assistantMessage: ChatMessage = { id: nextMsgId(), role: "assistant", content: "" };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setError(null);
      pendingSourcesRef.current = undefined;
      queueRef.current = "";
      doneStreamingRef.current = false;

      abortRef.current = new AbortController();

      try {
        const allMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(identifier.startsWith("storyline:")
              ? { storylineId: identifier.slice("storyline:".length) }
              : { slug: identifier }),
            messages: allMessages,
          }),
          signal: abortRef.current.signal,
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
              if (parsed.searching) {
                setIsSearching(true);
              }
              if (parsed.sources) {
                pendingSourcesRef.current = parsed.sources;
              }
              if (parsed.text) {
                setIsSearching(false);
                enqueueTokens(parsed.text);
              }
              if (parsed.error) {
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
        setError(message);
      } finally {
        // Signal the drain loop that no more tokens are coming
        doneStreamingRef.current = true;

        // Wait for the queue to fully drain before finalizing
        await waitForDrain();

        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        if (pendingSourcesRef.current) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                sources: pendingSourcesRef.current,
              };
            }
            return updated;
          });
        }
        setIsStreaming(false);
        setIsSearching(false);
        abortRef.current = null;
      }
    },
    [identifier, messages, isStreaming, enqueueTokens, waitForDrain]
  );

  const clearMessages = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
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

  return { messages, sendMessage, isStreaming, isSearching, error, clearMessages };
}
