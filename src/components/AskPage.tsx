"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Search, FileText } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { AskArticleGroups } from "./AskArticleGroups";
import {
  HERO_OFFSET,
  HERO_WIDTH_LOW,
  heroEase,
  heroEaseCurve,
  contentColumn,
} from "./hero-shared";
import type { AskStep, ChatMessage as ChatMessageType } from "@/lib/types";

/**
 * How much of the viewport the conversation claims once it starts.
 *
 * This is what sends the composer *down*. Search collapses the spacer above
 * its box so it rises into the header; here the thread below the header takes
 * a floor instead, and the composer is carried to the foot of the screen on
 * top of it. A minimum rather than a height, so it stops mattering the moment
 * a real answer is longer than it.
 *
 * Deliberately a little *more* than the space available, not a fit. Sized to
 * match the header exactly, the page comes out fractionally shorter than the
 * viewport, nothing overflows, `sticky bottom-0` has nothing to stick to, and
 * the composer halts partway down — which is what a first attempt at 58svh
 * did. Overshooting instead means the page always overflows by a little and
 * sticky clamps the composer to the viewport floor, landing it exactly at the
 * bottom whatever the header measures. The subtracted 14rem is what keeps that
 * overshoot to a couple of rem rather than a screenful of slack.
 */
const THREAD_MIN_HEIGHT = "calc(100svh - 14rem)";

/**
 * The composer's own 400ms plus a beat. The thread's floor is applied on the
 * same curve, so waiting for the slide to finish before the first message
 * fades in keeps it reading as one movement rather than two.
 */
const SEQ_MESSAGE_DELAY = 0.24;

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
  // A restored conversation arrives whole, so its cards should arrive with it
  // rather than staggering in as though they had just been retrieved — the
  // same reason the thread itself mounts with `initial={false}` below.
  const [restoredIds] = useState(() => new Set(initialMessages.map((m) => m.id)));
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

  // Keyed on the message *count*, not the messages themselves. Streaming
  // rewrites the last message on every animation frame, so depending on the
  // array would restart a smooth scroll ~60 times a second, each one fighting
  // the last and taking the page out from under anyone trying to read up. One
  // scroll per new exchange is the whole intent.
  const messageCount = messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messageCount, reduceMotion]);

  const empty = messages.length === 0;

  return (
    <div className="min-h-dvh bg-background">
      {/* Header. Outside the thread, so it stays put while the composer
          travels — the same arrangement Search uses. */}
      <div className={`${contentColumn} pt-8`}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-medium mb-1">Ask</h1>
            <p className="text-sm text-muted">
              Questions answered from the articles you&rsquo;ve collected.
            </p>
          </div>
          {!empty && (
            <button
              onClick={clearMessages}
              className="shrink-0 text-sm text-muted transition-colors hover:text-foreground"
            >
              New chat
            </button>
          )}
        </div>
      </div>

      {/* No bottom padding here: the sticky composer below carries its own,
          which is what gives the thread room to scroll clear of it. Adding it
          in both places just leaves dead space under the last message. */}
      <div className={contentColumn}>
        {/* Search widens from this to the full column as it rises; here the
            measure never changes, because what arrives is prose rather than a
            grid. Same width as Search's resting state, hence the shared
            constant — but no transition, since nothing moves. */}
        <div className="mx-auto w-full" style={{ maxWidth: HERO_WIDTH_LOW }}>
          {/* One property, one direction.

              This began as a spacer above the composer collapsing from 20svh
              to 0 while this floor grew from 0 — two animated properties on
              two elements pulling the composer opposite ways. Even matched in
              duration and curve, that reads as a stumble rather than a slide,
              and `min-height` going from a bare 0 to a calc() is the sort of
              pair a browser may snap instead of tween.

              So the empty-state offset lives here too: the thread simply grows
              from where Search's box sits to filling the viewport, and the
              composer rides down on top of it. */}
          <div
            className={`transition-[min-height] ${heroEase}`}
            style={{ minHeight: empty ? HERO_OFFSET : THREAD_MIN_HEIGHT }}
          >
            {/* Held back until the composer has most of the way to travel.
                Arriving together reads as two things moving at once; arriving
                behind it reads as the page making room.

                Driven by `empty` rather than by mounting: this wrapper is
                always rendered, so a mount-time `initial` would fade an empty
                container on page load and then do nothing on the first
                question — which is exactly backwards. `initial={false}` also
                keeps a restored conversation from fading in on arrival. */}
            <motion.div
              className="space-y-8"
              initial={false}
              animate={{ opacity: empty ? 0 : 1 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, delay: SEQ_MESSAGE_DELAY, ease: heroEaseCurve }
              }
            >
              {messages.map((message, i) => {
                const stillArriving = isStreaming && i === messages.length - 1;

                return (
                  <div key={message.id} className="space-y-3">
                    {/* Inside the reply, above its own working — a reply that
                        has not started is still the thing happening under the
                        question just asked. Rendered after the list instead, it
                        sank below the retrieval steps and article cards, so the
                        one element saying "something is happening" ended up
                        furthest from the question that started it. */}
                    {stillArriving &&
                      message.role === "assistant" &&
                      message.content === "" && (
                        <div className="font-serif text-base italic">
                          <span className="thinking-shimmer">
                            {isSearching ? "Searching the web..." : "Thinking..."}
                          </span>
                        </div>
                      )}

                    {/* The steps do run live, unlike the cards below. They are
                        the answer being worked on rather than part of it, and
                        they are all there is to see during the seconds before
                        any text arrives. */}
                    {message.steps && message.steps.length > 0 && (
                      <div className="space-y-1">
                        {message.steps.map((step, i) => (
                          <StepChip key={i} step={step} />
                        ))}
                      </div>
                    )}

                    <ChatMessage message={message} />

                    {/* Held until the answer is whole, like the sources beneath
                        it. Which articles were cited is not knowable before
                        then, and cards that appear mid-answer only to regroup
                        at the end of it are movement the reader has to ignore
                        twice. */}
                    {!stillArriving && message.articles && message.articles.length > 0 && (
                      <div className="pt-1">
                        <AskArticleGroups
                          articles={message.articles}
                          content={message.content}
                          entrance={!restoredIds.has(message.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
              )}

              <div ref={endRef} />
            </motion.div>
          </div>

          {/* The strip below the composer, blurred rather than painted or bare.
              This page needs something the other three do not: they scroll
              cards past the dock, where overlap reads as depth, but an answer
              is prose — text sliding uncovered behind a text field is just
              hard to read. Opaque made the page look like it stopped at the
              input; clear made it unreadable. Blurring keeps the evidence that
              the page continues while removing the competition for attention.

              The tint carries it alone where `backdrop-filter` is unsupported,
              which is why it is not fully transparent. */}
          <div className="sticky bottom-0 bg-background/45 pt-2 pb-24 backdrop-blur-sm md:pb-28">
            <ChatInput
              onSend={sendMessage}
              disabled={isStreaming}
              placeholder="Ask about your news..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
