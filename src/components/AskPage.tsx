"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@heroui/react";
import { Search, FileText } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { AskArticleCard } from "./AskArticleCard";
import type { AskStep, ChatMessage as ChatMessageType } from "@/lib/types";

/**
 * Where an in-progress conversation is kept.
 *
 * A destination page sets a different expectation from the article panel:
 * people navigate away, come back, and expect the thread still there. Session
 * storage covers exactly that — a refresh or a trip to an article and back —
 * without introducing a conversations table for something that has not yet
 * been asked for. The endpoint stays stateless, so real history could be
 * added later without reshaping anything.
 */
const STORAGE_KEY = "ask:conversation";

const SUGGESTIONS = [
  "What were the biggest stories this week?",
  "What's happening with AI chips?",
  "Summarise the Singapore news",
  "What should I know about the markets?",
];

function loadStored(): ChatMessageType[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function StepChip({ step }: { step: AskStep }) {
  const Icon = step.tool === "search_articles" ? Search : FileText;
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex items-center gap-1.5 text-xs text-muted"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{step.detail}</span>
    </motion.div>
  );
}

/**
 * Rendered client-only (see `AskLoader`), which is what lets the stored
 * conversation seed state directly. Reading sessionStorage during a render the
 * server also performs would either mismatch on hydration or force a
 * restore-in-effect, and neither is worth it for a page with no server data.
 */
export function AskPage() {
  const [initialMessages] = useState<ChatMessageType[]>(loadStored);
  const reduceMotion = useReducedMotion();
  const { messages, sendMessage, isStreaming, isSearching, error, clearMessages } = useChat({
    endpoint: "/api/ask",
    initialMessages,
  });

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (messages.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // A full or unavailable quota costs persistence, not the conversation.
    }
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, reduceMotion]);

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5">
      <header className="flex items-baseline justify-between pt-16 pb-6">
        <div>
          <h1 className="font-serif text-2xl tracking-tight text-foreground">Ask</h1>
          <p className="mt-1 text-sm text-muted">
            Questions answered from the articles you&rsquo;ve collected.
          </p>
        </div>
        {!empty && (
          <button
            onClick={clearMessages}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            New chat
          </button>
        )}
      </header>

      <div className="flex-1 space-y-8 pb-4">
        {messages.map((message) => (
          <div key={message.id} className="space-y-3">
            {message.steps && message.steps.length > 0 && (
              <div className="space-y-1">
                {message.steps.map((step, i) => (
                  <StepChip key={i} step={step} />
                ))}
              </div>
            )}

            <ChatMessage message={message} />

            {message.articles && message.articles.length > 0 && (
              <div className="grid gap-2 pt-1 sm:grid-cols-2">
                {message.articles.map((article, i) => (
                  <AskArticleCard key={article.slug} article={article} index={i} />
                ))}
              </div>
            )}
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.content === "" && (
          <div className="font-serif text-base italic">
            <span className="thinking-shimmer">
              {isSearching ? "Searching the web..." : "Thinking..."}
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-background pb-28 pt-2">
        <AnimatePresence>
          {empty && !isStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap gap-2 pb-3"
            >
              {SUGGESTIONS.map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  onPress={() => sendMessage(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <ChatInput onSend={sendMessage} disabled={isStreaming} />
      </div>
    </div>
  );
}
