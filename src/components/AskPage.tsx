"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Tooltip } from "@heroui/react";
import { Search, FileText, Info } from "lucide-react";
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

// The three levers a reader actually has over what gets retrieved: how much
// time, which feed, how deep. Each row changes how you would word a question.
//
// Deliberately not a menu of things Ask can answer. Plain topic questions and
// follow-ups were here and came out again — asking a chat box a question and
// then another one is the affordance, not a tip, and rows that teach nothing
// dilute the ones that do.
//
// Every row is something the model is instructed to do — see
// buildGlobalSystemPrompt() in lib/chat and the tool descriptions in
// lib/ask-tools. The date row leads because it is the one people get wrong:
// asked as a topic search for the word "news", a day comes back as a 1-in-9
// sample of itself, which is why the model is told to pass a date range and
// no query at all.
const askTips: Array<{ example: string; meaning: string }> = [
  { example: "What happened today?", meaning: "A stretch of time rather than a topic — this week, or a date, work the same way" },
  { example: "Anything in the Singapore feed on housing?", meaning: "Naming a feed narrows the search to that one" },
  { example: "What exactly did they say about the layoffs?", meaning: "Opens the article and reads it whole, where a summary will not do" },
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

/**
 * How long a greeting holds before the next one takes over.
 *
 * Long enough that it is not competing with the cursor for attention, short
 * enough that a second one arrives before most people have finished deciding
 * what to ask.
 */
const GREETING_ROTATE_MS = 10_000;

/**
 * The lines above the composer, by the reader's own clock.
 *
 * Local time, deliberately, and not the `ARCHIVE_TZ` the rest of the app dates
 * articles by: everything else here is a statement about the archive, where
 * Singapore days are the only ones that line up with `articles.date`, but this
 * is a statement about the person reading. Getting it from the browser means
 * it agrees with the window they are sitting next to.
 *
 * Every line closes: a full stop, or a question mark where the line asks
 * something. Unpunctuated they read as labels rather than as someone speaking,
 * which is the opposite of what a greeting is for. The exclamation is reserved
 * for the plain salutation that opens each set — spread across the wry lines it
 * would oversell them.
 *
 * `*asterisks*` mark the word that takes the accent — see `accentGreeting`.
 * One per line, and never the whole line: the colour is there to give the
 * phrase a beat, and a fully orange greeting is just a coloured greeting.
 *
 * Kept short on purpose. The line swaps in place inside a fixed-height slot,
 * and one that wraps to two lines on a phone would shove the composer down
 * every ten seconds — which puts the ceiling at roughly 26 characters, the
 * width of a 375px screen at this size.
 *
 * Each set is written plain greeting first, then wry, then flatly sarcastic —
 * though only the first line keeps its place, since `greetingsFor` shuffles
 * everything after it. What that ordering really guarantees is that the page
 * opens straight and the reader has to linger to be needled.
 *
 * The sarcastic ones are read by exactly one person: whoever owns the archive,
 * on a page they came to voluntarily, at an hour of their choosing. Nothing
 * here lands on anybody else, which is what makes "This is healthy." at 3am
 * funny rather than rude.
 *
 * The small hours get their own set rather than being folded into the evening:
 * someone asking at 2am has not started their day early, they have not
 * finished the last one, and a bright "Good evening" reads as a machine that
 * has not looked at the clock.
 */
function greetingPool(hour: number): string[] {
  if (hour < 5) {
    return [
      "Still *up*?",
      "The *quiet* hours.",
      "*Late* edition.",
      "Nothing else is *awake*.",
      "The *night* shift.",
      "Burning the *midnight* oil.",
      "Sleep is a *construct*.",
      "*Elegant* doomscrolling.",
      "Tomorrow's *problem*.",
      "This is *healthy*.",
      "Nothing bad *happened*.",
      "Well *rested*, obviously.",
    ];
  }
  if (hour < 12) {
    return [
      "Good *morning*!",
      "*Fresh* from the feeds.",
      "What the night *brought*.",
      "While you *slept*.",
      "The morning's *catch*.",
      "First *coffee*?",
      "The world *survived*.",
      "Rise and *doomscroll*.",
      "Anything on *fire*?",
      "All *fixed* overnight.",
      "Everything's *fine*.",
      "*Good* news, surely.",
    ];
  }
  if (hour < 18) {
    return [
      "Good *afternoon*!",
      "*Caught* up yet?",
      "What is *developing*?",
      "The day, so *far*.",
      "*Midday*, mid-story.",
      "Still *unfolding*.",
      "Beats *working*.",
      "Pretend it's *research*.",
      "Better than *emails*.",
      "*Productive*, this.",
      "Nothing urgent, *surely*.",
      "The *work* will keep.",
    ];
  }
  return [
    "Good *evening*!",
    "The day, in *summary*.",
    "What did you *miss*?",
    "Anything still *unclear*?",
    "*Close* out the day.",
    "The *headlines*, distilled.",
    "Unwind with *catastrophe*.",
    "Bedtime *stories*.",
    "The world, *recapped*.",
    "*Soothing*, as ever.",
    "Sleep well *after* this.",
    "Nothing to worry *about*.",
  ];
}

/**
 * The pool in the order one visit will see it.
 *
 * The plain greeting always leads, so the page opens calmly and the rest
 * arrive as the reader lingers rather than greeting them with a wisecrack.
 * Everything after it is shuffled, because a fixed order means the reader who
 * waits ten seconds sees the same second line every single morning — which is
 * the boredom the variations were added to fix, only slower.
 */
function greetingsFor(hour: number): string[] {
  const [first, ...rest] = greetingPool(hour);

  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return [first, ...rest];
}

/**
 * Splits a greeting on its `*marked*` word, so it can be coloured.
 *
 * The capture group is what puts the marked words on the odd indices —
 * `"Good *morning*"` becomes `["Good ", "morning", ""]` — which is the whole
 * trick. A line with no asterisks simply comes back as one plain segment.
 */
function accentGreeting(line: string) {
  return line.split(/\*(.+?)\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-accent">
        {part}
      </span>
    ) : (
      part
    )
  );
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

  const [tipsOpen, setTipsOpen] = useState(false);
  const [greetings] = useState(() => greetingsFor(new Date().getHours()));
  const [greetingIndex, setGreetingIndex] = useState(0);

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

  // Only while the page is bare. Once a conversation exists the greeting is
  // gone, and an interval still firing behind it would be re-rendering the
  // whole thread every ten seconds for a line nobody can see.
  //
  // Rotation stops entirely under `prefers-reduced-motion`: text that replaces
  // itself in the corner of your eye is exactly the involuntary movement the
  // setting is there to refuse, and a crossfade does not make it optional.
  useEffect(() => {
    if (!empty || reduceMotion) return;

    const id = setInterval(
      () => setGreetingIndex((i) => (i + 1) % greetings.length),
      GREETING_ROTATE_MS
    );
    return () => clearInterval(id);
  }, [empty, reduceMotion, greetings.length]);

  return (
    <div className="min-h-dvh bg-background">
      {/* Header. Outside the thread, so it stays put while the composer
          travels — the same arrangement Search uses. */}
      <div className={`${contentColumn} pt-8`}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-medium mb-1">Ask</h1>
            <p className="text-sm text-muted">
              Ask anything about your news.
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
            {/* The greeting rides above the composer rather than sitting in
                the gap above it, so it travels *with* the input on the way
                down instead of being left behind by it — and leaves on the
                same curve, collapsing its height rather than just fading, so
                the composer's slide stays one movement.

                Serif and unhurried: it is the only thing on the page that is
                not an instrument. */}
            <AnimatePresence>
              {empty && (
                <motion.div
                  initial={false}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={
                    reduceMotion ? { duration: 0 } : { duration: 0.4, ease: heroEaseCurve }
                  }
                  className="mb-10 overflow-hidden text-center md:mb-12"
                >
                  {/* A fixed slot for the line to swap inside. `mode="wait"`
                      unmounts the old greeting before the new one mounts, so
                      without a floor here the container would collapse to
                      nothing between the two and kick the composer up the
                      page every ten seconds. Matched to the line height at
                      each breakpoint. */}
                  <div className="flex min-h-8 items-center justify-center md:min-h-9">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p
                        key={greetings[greetingIndex]}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
                        className="font-serif text-2xl font-medium md:text-3xl"
                      >
                        {accentGreeting(greetings[greetingIndex])}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <ChatInput
              onSend={sendMessage}
              disabled={isStreaming}
              placeholder="Ask about your news..."
            />

            {/* The empty page's one hint, in Search's position: under the
                input, not above it. Above, it sat in the gap the composer is
                about to travel through, so the first question had it moving
                out of the way of the thing it was explaining.

                Controlled rather than left to react-aria's hover/focus alone
                — a tooltip that only opens on hover is unreachable on a
                phone, and the click handler is what gives touch a way in. */}
            <AnimatePresence>
              {empty && (
                <motion.div
                  initial={false}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={
                    reduceMotion ? { duration: 0 } : { duration: 0.4, ease: heroEaseCurve }
                  }
                  className="mt-8 flex justify-center overflow-hidden md:mt-10"
                >
                  <Tooltip.Root
                    isOpen={tipsOpen}
                    onOpenChange={setTipsOpen}
                    delay={150}
                    closeDelay={150}
                  >
                    <Tooltip.Trigger
                      aria-label="How Ask works"
                      onClick={() => setTipsOpen((open) => !open)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden />
                      How Ask works
                    </Tooltip.Trigger>
                    <Tooltip.Content placement="bottom" offset={10} showArrow>
                      <Tooltip.Arrow />
                      {/* `.tooltip` sets `break-all`, which would split the
                          example questions mid-word; it inherits, so the
                          override goes here. */}
                      <div className="w-[19rem] max-w-full break-normal p-1 text-left">
                        <dl className="space-y-2">
                          {askTips.map((tip) => (
                            <div key={tip.example}>
                              {/* Questions, so they read as speech rather than
                                  as syntax to be typed exactly — which is what
                                  Search's boxed code examples are. */}
                              <dt className="text-foreground">&ldquo;{tip.example}&rdquo;</dt>
                              <dd className="mt-1 text-muted">{tip.meaning}</dd>
                            </div>
                          ))}
                        </dl>

                        {/* How it finds things, and where it looks — one
                            line each. The first is the part worth knowing:
                            retrieval fuses a full-text match with a vector
                            one (see hybridSearchArticles), which is why a
                            question phrased nothing like the headline still
                            works. */}
                        <div className="mt-3 space-y-2 border-t border-border pt-3 text-muted">
                          <p>
                            Each question is searched two ways at once — by wording
                            and by meaning — so an article that never uses your
                            words can still come back.
                          </p>
                          <p>
                            Your archive first, the web only for the gaps. The answer
                            says which is which.
                          </p>
                        </div>
                      </div>
                    </Tooltip.Content>
                  </Tooltip.Root>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
