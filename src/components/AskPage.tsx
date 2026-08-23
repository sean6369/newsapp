"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Disclosure, Tooltip } from "@heroui/react";
import { Search, FileText, Info, SquarePen } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { newConversationId, useConversations } from "@/hooks/useConversations";
import { fallbackTitle } from "@/lib/conversation-title";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatHistoryDrawer } from "./ChatHistoryDrawer";
import { AskArticleGroups } from "./AskArticleGroups";
import {
  HERO_OFFSET,
  HERO_WIDTH_LOW,
  heroEase,
  heroEaseCurve,
  contentColumn,
} from "./hero-shared";
import type {
  AskStep,
  ChatMessage as ChatMessageType,
  Conversation,
} from "@/lib/types";

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
 * How the greeting and the hint come and go around the composer's travel.
 *
 * Height and opacity deliberately no longer share a duration. Fading across
 * the full 400ms left the greeting legible for most of the composer's slide,
 * which reads as two things moving at once where the page is trying to show
 * one: the text was still there, half-erased, while the thing it sat above had
 * already left. So on the way out the text goes first and the space closes
 * behind it — the fade is done inside the opening 40% of the collapse.
 *
 * Coming back is the same statement reversed. The space opens on the same
 * curve, and the greeting arrives late, once there is somewhere for it to be,
 * rather than appearing in a slot that is still expanding around it. Both
 * keep `heroEaseCurve` on the height, which is what holds them to the
 * composer's own CSS transition.
 *
 * The easing matters more than the duration here, which a first attempt at
 * this got backwards. `easeIn` holds near full opacity and drops at the end,
 * so a 160ms fade still read as the greeting hanging about — most of that
 * time was spent barely changing. `easeOut` spends the opacity immediately,
 * which is what makes a short fade feel short. Both directions use it, so the
 * text leaves as decisively as it arrives.
 */
const HERO_ASIDE_EXIT: Transition = {
  height: { duration: 0.4, ease: heroEaseCurve },
  opacity: { duration: 0.09, ease: "easeOut" },
};

// `delay + duration` lands the text exactly as the space finishes opening.
// Keep that sum at the height's 0.4 if either number is retuned.
const HERO_ASIDE_ENTER: Transition = {
  height: { duration: 0.4, ease: heroEaseCurve },
  opacity: { duration: 0.12, delay: 0.28, ease: "easeOut" },
};

/** Reduced motion keeps the same two states and skips the travel between. */
const HERO_ASIDE_INSTANT: Transition = { duration: 0 };

/**
 * Where the thread currently on screen is kept.
 *
 * Not the history — that is the `conversations` table, read through
 * `useConversations`. This is the cache in front of it, covering the one case
 * the database is a clumsy answer to: a refresh, or a trip to an article and
 * back, where the reader expects the same thread still there and instantly.
 * Restoring from the server instead would mean a spinner on a page that
 * currently renders its conversation in the first frame.
 *
 * It holds the conversation's id alongside the messages so a restored thread
 * keeps saving into the row it came from rather than forking a second copy on
 * every refresh.
 *
 * `/api/ask` remains stateless: it is handed the whole thread with each
 * question and stores nothing.
 */
const STORAGE_KEY = "ask:conversation";

/** The thread on screen, as sessionStorage holds it between page loads. */
interface StoredThread {
  /** The row in `conversations` this is; null until its first answer is saved. */
  id: string | null;
  messages: ChatMessageType[];
}

const EMPTY_THREAD: StoredThread = { id: null, messages: [] };

/**
 * The header's icon buttons.
 *
 * Captioned for screen readers only: there is room beside the title for two
 * icons but not for two labels.
 */
const ICON_BUTTON =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-border/50 hover:text-foreground";

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

function loadStored(): StoredThread {
  if (typeof window === "undefined") return EMPTY_THREAD;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    // The key held a bare array before conversations were kept server-side. A
    // tab open across the deploy still has one, and it is a real thread the
    // reader can see — read it, and let the next answer give it an id.
    if (Array.isArray(parsed)) return { id: null, messages: parsed };

    if (parsed && Array.isArray(parsed.messages)) {
      return {
        id: typeof parsed.id === "string" ? parsed.id : null,
        messages: parsed.messages,
      };
    }

    return EMPTY_THREAD;
  } catch {
    return EMPTY_THREAD;
  }
}

/**
 * A thread reduced to what decides whether it is worth saving again.
 *
 * The save effect runs on every settled render, and most of those are nothing
 * new: the reader opened the history drawer, the conversation was just given
 * its id, a stored thread was reopened from the drawer. Comparing signatures
 * keeps those from becoming writes.
 *
 * It is no longer the only thing standing between a redundant save and a
 * reordered drawer — `saveConversation` will not move a conversation whose
 * thread has not changed — but it still spares the round trip.
 *
 * The last message's length rather than its content: while an answer streams
 * it is the only thing changing, and it only ever grows.
 */
function threadSignature(id: string | null, messages: ChatMessageType[]): string {
  const last = messages[messages.length - 1];
  return `${id}:${messages.length}:${last ? last.content.length : 0}`;
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

/**
 * What a reply's retrieval amounted to, in one line.
 *
 * Counted by kind rather than totalled, because the two are different work and
 * the reader can tell: a search is the model casting about, and opening an
 * article is it deciding a summary would not do. "3 steps" would hide that
 * distinction behind the only number the two have in common.
 */
function describeSteps(steps: AskStep[]): string {
  const searches = steps.filter((step) => step.tool === "search_articles").length;
  const reads = steps.length - searches;

  const parts: string[] = [];
  if (searches > 0) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  if (reads > 0) parts.push(`${reads} article${reads === 1 ? "" : "s"} read`);

  return parts.join(", ");
}

/**
 * A fold for the parts of a reply that are not the reply.
 *
 * The searches behind an answer and the articles under it are both evidence
 * rather than prose, and a thread of several exchanges is mostly evidence by
 * volume. Folding them puts the answers back within one screen of each other
 * without throwing the working away — it is still a click, not a rebuild.
 */
function CollapsibleAside({
  summary,
  children,
  isExpanded,
  defaultExpanded,
  onExpandedChange,
}: {
  summary: string;
  children: ReactNode;
  isExpanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  return (
    <Disclosure.Root
      isExpanded={isExpanded}
      defaultExpanded={defaultExpanded}
      onExpandedChange={onExpandedChange}
    >
      {/* No `Disclosure.Heading` around the trigger, which is the component's
          usual shape. It renders an `<h3>`, and the APG only asks for a
          heading where the disclosure is a section of the page — these are
          folds inside a message. Wrapping them would put "2 searches" and "5
          articles" into the document outline, so a screen reader navigating
          this page by heading would wade through the working of every reply
          to reach the next one. */}
      <Disclosure.Trigger className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground">
        {summary}
        {/* `ml-0` undoes the component's own `ml-auto`, which is there to push
            the chevron to the far edge of a full-width row. This trigger is
            only as wide as its label, so the chevron belongs beside the
            words. */}
        <Disclosure.Indicator className="ml-0 h-3.5 w-3.5" />
      </Disclosure.Trigger>
      <Disclosure.Content>
        {/* Cancelling three sides of the body's own `p-2`. Left inset would
            step the chips and the article grid in from the answer they belong
            to, which is the one thing folding these was not meant to change;
            the top 8px is kept, as the gap under the trigger. */}
        <Disclosure.Body className="-mx-2 -mb-2">{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure.Root>
  );
}

/**
 * The retrieval behind one reply: open while it happens, folded once it is
 * over.
 *
 * Expansion follows `live` until the reader touches it, and their choice wins
 * from then on. That is what lets the steps be both — the only thing to watch
 * during the seconds before any text arrives, and a single line the moment the
 * answer makes them redundant — while still folding on the disclosure's own
 * height transition rather than vanishing.
 */
function StepsSection({ steps, live }: { steps: AskStep[]; live: boolean }) {
  const [choice, setChoice] = useState<boolean | null>(null);

  return (
    <CollapsibleAside
      summary={describeSteps(steps)}
      isExpanded={choice ?? live}
      onExpandedChange={setChoice}
    >
      <div className="space-y-1">
        {steps.map((step, i) => (
          <StepChip key={i} step={step} />
        ))}
      </div>
    </CollapsibleAside>
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
  const [stored] = useState<StoredThread>(loadStored);
  // A restored conversation arrives whole, so its cards should arrive with it
  // rather than staggering in as though they had just been retrieved — the
  // same reason the thread itself mounts with `initial={false}` below.
  //
  // Stateful rather than computed once, because a thread can now also arrive
  // from the history drawer, and one opened an hour after the page loaded is
  // no less restored than the one it loaded with.
  const [restoredIds, setRestoredIds] = useState(
    () => new Set(stored.messages.map((m) => m.id))
  );
  const reduceMotion = useReducedMotion();
  // No list here — the drawer fetches that when it opens. This mount is only
  // for `save`, which shares the drawer's SWR cache and so refreshes it.
  const { save } = useConversations();

  /**
   * Conversations still being answered somewhere other than on screen.
   *
   * The reader asked, walked off to read something else, and the reply is
   * still arriving. Each is kept with the title it would be listed under so
   * the drawer can show it working — a chat that is merely absent for a minute
   * looks lost, and this is the difference between backgrounding a reply and
   * discarding one.
   */
  const [background, setBackground] = useState<Array<{ id: string; title: string }>>([]);

  /**
   * The half of a finished background reply that needs the view.
   *
   * Held in a ref and filled in below rather than written inline, because the
   * inline version reached forward into `replaceMessages` and `isStreaming` —
   * values destructured from the very `useChat` call the handler is an
   * argument to. That works at runtime, since the handler only runs later, but
   * it is a cycle on the page, and the React Compiler answers a cycle by
   * giving up on the whole component. The hook solves the same problem the
   * same way for this very callback.
   */
  const landBackgroundReply = useRef<(thread: ChatMessageType[], id: string) => void>(() => {});

  const {
    messages,
    sendMessage,
    isStreaming,
    isSearching,
    error,
    clearMessages,
    replaceMessages,
  } = useChat({
    endpoint: "/api/ask",
    initialMessages: stored.messages,
    // The reply outlived the thread it was written into, so it is stored
    // straight from here rather than through the save effect below — that one
    // watches what is on screen, and this is by definition not.
    onBackgroundFinish: (thread, id) => {
      // A null thread is a reply that failed with nothing to show for it. The
      // row still has to stop saying it is being answered, or the conversation
      // would sit in the drawer marked busy until a reload.
      if (thread) {
        save(id, thread);
        landBackgroundReply.current(thread, id);
      }
      setBackground((current) => current.filter((c) => c.id !== id));
    },
  });

  /**
   * Which conversation is on screen. Null on a bare page, and set the moment a
   * question is asked — before the row it names exists, which is deliberate;
   * see `handleSend`.
   */
  const [activeId, setActiveId] = useState<string | null>(stored.id);
  /**
   * The thread as the server last confirmed it, so settled renders that change
   * nothing do not become writes.
   *
   * Deliberately *not* seeded from what was restored. A thread comes back from
   * sessionStorage whether or not its first save ever completed — the title
   * call takes a couple of seconds, and a reload inside that window leaves a
   * conversation the reader can still see and the table has never heard of.
   * Starting empty means every restored thread attempts one save on mount,
   * which rescues exactly that case.
   *
   * What makes that affordable is the server: re-saving an unchanged thread
   * leaves `updated_at` alone (see `saveConversation`), so the rescue cannot
   * reorder the drawer. The cost is one cheap request per load — the title is
   * only generated when the row is genuinely new.
   */
  const savedSignature = useRef("");

  const [tipsOpen, setTipsOpen] = useState(false);
  const [greetings] = useState(() => greetingsFor(new Date().getHours()));
  const [greetingIndex, setGreetingIndex] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);

  //
  // Held back while a reply is arriving. The token queue rewrites the last
  // message on every animation frame, and this effect follows `messages`, so
  // without the guard a settled thread — retrieval steps, article cards and
  // all — was being serialised and written to storage sixty times a second
  // for the length of every answer.
  //
  // Nothing is lost by waiting: `isStreaming` drops the moment the reply is
  // whole, which runs this with the finished thread. A reload mid-answer
  // restores the conversation as it stood before the question, which is the
  // honest thing to keep — the reply it was missing did not survive the reload
  // either.
  useEffect(() => {
    if (isStreaming) return;

    try {
      if (messages.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: activeId, messages }));
    } catch {
      // A full or unavailable quota costs persistence, not the conversation.
    }
  }, [messages, activeId, isStreaming]);

  /**
   * Keep the finished conversation.
   *
   * After the answer, not during it: a thread saved mid-stream would store a
   * half-written reply, and every frame of the token queue would be another
   * write. Waiting also means the conversation is named from something worth
   * naming — the title is generated on the request that creates the row.
   *
   * Nothing is awaited and nothing is shown. The answer is already on screen,
   * so a save that fails costs the reader their history, not their reply, and
   * `useConversations` reports it to the console rather than over the page.
   */
  useEffect(() => {
    if (isStreaming || !activeId || messages.length === 0) return;

    const last = messages[messages.length - 1];
    // An empty assistant message is a reply that never arrived — a request that
    // failed, or one abandoned by switching threads. There is nothing to keep.
    if (last.role !== "assistant" || last.content === "") return;

    const signature = threadSignature(activeId, messages);
    if (savedSignature.current === signature) return;
    savedSignature.current = signature;

    save(activeId, messages);
  }, [isStreaming, messages, activeId, save]);

  /**
   * Show a finished background reply to a reader who came back for it.
   *
   * They opened this conversation while it was still being written, so what is
   * on screen is the thread as it was last saved. Rather than leave that
   * quietly out of date, the completed thread replaces it.
   *
   * Skipped while anything is streaming: they may have asked a fresh question
   * here in the meantime, and a thread assembled before that question existed
   * would erase the reply they are currently watching.
   *
   * Assigned on every render, so the values it closes over are the current
   * ones rather than whichever were in scope when the reply began.
   */
  useEffect(() => {
    landBackgroundReply.current = (thread, id) => {
      if (id !== activeId || isStreaming) return;

      replaceMessages(thread);
      // Its cards arrive with it rather than staggering in, like any other
      // thread that was not watched being written.
      setRestoredIds((current) => new Set([...current, ...thread.map((m) => m.id)]));
      // Recorded as stored, because it is: this thread came back from the save
      // that preceded it, so the save effect has nothing left to write.
      savedSignature.current = threadSignature(id, thread);
    };
  });

  // Keyed on the last message's *identity*, not on the array. Streaming
  // rewrites that message on every animation frame, so depending on the array
  // would restart a smooth scroll ~60 times a second, each one fighting the
  // last and taking the page out from under anyone trying to read up.
  //
  // The id rather than the count, which was the earlier version of this: a
  // conversation opened from the history drawer replaces the thread outright,
  // and one that happened to hold as many messages as the one it replaced
  // would have left the reader at the old scroll position in a new chat.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [lastMessageId, reduceMotion]);

  /**
   * Ask, giving the conversation an identity if it does not have one yet.
   *
   * The id is minted here rather than by the save that first needs it, so it
   * exists before anything can want it — the save effect above simply has an
   * `activeId` or does not, and nothing has to reconcile a thread that
   * acquired one halfway through. Nothing is written yet: an id with no
   * answer behind it never reaches the server, so a question whose reply
   * fails leaves no empty chat in the drawer.
   */
  const handleSend = useCallback(
    (text: string) => {
      const id = activeId ?? newConversationId();
      if (!activeId) setActiveId(id);
      // The id rides with the reply. If the reader walks away before it lands,
      // this is what tells `onBackgroundFinish` which conversation it belongs
      // to — reading `activeId` at that point would name whichever chat they
      // had moved on to.
      sendMessage(text, id);
    },
    [activeId, sendMessage]
  );

  /**
   * Leave the conversation on screen, keeping any reply still arriving.
   *
   * The hook is asked whether it actually detached something rather than being
   * told: `isStreaming` here is a snapshot from the last render, and a reply
   * that finished while the drawer was fetching the chat being opened would
   * have this recording a background reply that does not exist — a row stuck
   * on "Answering…" for the rest of the session, unopenable because it is
   * marked busy and undeletable for the same reason.
   *
   * The title and id are read from the outgoing render, which is safe where
   * `isStreaming` is not: neither changes while a reply is in flight, since
   * the conversation is named by its first question and given its id when that
   * question is sent.
   */
  const leaveFor = useCallback(
    (next: ChatMessageType[]) => {
      const leaving = activeId;
      const title = fallbackTitle(messages);

      if (replaceMessages(next) && leaving) {
        setBackground((current) =>
          current.some((c) => c.id === leaving) ? current : [...current, { id: leaving, title }]
        );
      }
    },
    [replaceMessages, activeId, messages]
  );

  /**
   * Start over. Only the page is reset — the conversation being left stays in
   * the drawer, which is the whole difference this makes to the button: it
   * used to be the one thing that could destroy a thread.
   */
  const startNewChat = useCallback(() => {
    // `leaveFor([])`, not `clearMessages()`: leaving a conversation is not the
    // same as binning it, and a reply already being written is worth having in
    // history whether or not the reader stayed for it.
    leaveFor([]);
    setActiveId(null);
    setRestoredIds(new Set());
    savedSignature.current = threadSignature(null, []);
  }, [leaveFor]);

  /**
   * The conversation on screen was deleted from the drawer.
   *
   * Discards the reply outright rather than backgrounding it — the one place
   * that distinction is load-bearing rather than merely tidy.
   */
  const handleActiveDeleted = useCallback(() => {
    // `clearMessages()` here, which aborts. Backgrounding the reply would save
    // it, and saving it would restore — seconds later, with nothing to explain
    // it — the row the reader just deleted.
    clearMessages();
    setActiveId(null);
    setRestoredIds(new Set());
    savedSignature.current = threadSignature(null, []);
  }, [clearMessages]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      leaveFor(conversation.messages);
      setActiveId(conversation.id);
      setRestoredIds(new Set(conversation.messages.map((m) => m.id)));
      // Recorded as already saved, so merely reading a chat does not rewrite it
      // and lift it to the top of the drawer.
      savedSignature.current = threadSignature(conversation.id, conversation.messages);
    },
    [leaveFor]
  );

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

          {/* Top right, at the same weight as the description opposite —
              neither is what you came to this page to press. */}
          <div className="flex shrink-0 items-center gap-1">
            <ChatHistoryDrawer
              triggerClassName={ICON_BUTTON}
              activeId={activeId}
              /* The chat on screen, plus any still being answered elsewhere.
                 Named by the same truncation the server falls back to, so a row
                 does not visibly re-wrap when the written title replaces it. */
              pending={[
                ...(activeId && messages.length > 0
                  ? [
                      {
                        id: activeId,
                        title: fallbackTitle(messages),
                        label: isStreaming ? "Answering…" : "Saving…",
                      },
                    ]
                  : []),
                /* Filtered against the row above it. The two can now name the
                   same conversation — the reader can be sitting in a chat that
                   is still being answered — and two entries sharing an id
                   would be two React keys sharing one. */
                ...background
                  .filter((c) => c.id !== activeId)
                  .map((c) => ({ id: c.id, title: c.title, label: "Answering…" })),
              ]}
              busyIds={background.map((c) => c.id)}
              onSelect={openConversation}
              onActiveDeleted={handleActiveDeleted}
            />
            {/* Still only offered when there is a conversation to leave. */}
            {!empty && (
              <button onClick={startNewChat} className={ICON_BUTTON}>
                <SquarePen className="h-[18px] w-[18px]" aria-hidden />
                <span className="sr-only">New chat</span>
              </button>
            )}
          </div>
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
                        any text arrives — which is why they open themselves
                        and then fold away once there is an answer instead. */}
                    {message.steps && message.steps.length > 0 && (
                      <StepsSection steps={message.steps} live={stillArriving} />
                    )}

                    <ChatMessage message={message} />

                    {/* Held until the answer is whole, like the sources beneath
                        it. Which articles were cited is not knowable before
                        then, and cards that appear mid-answer only to regroup
                        at the end of it are movement the reader has to ignore
                        twice. */}
                    {!stillArriving && message.articles && message.articles.length > 0 && (
                      <div className="pt-1">
                        {/* Open by default, unlike the steps above. These are
                            what the answer rests on rather than how it was
                            found, and a reply whose evidence is hidden until
                            asked for is a different page from this one. */}
                        <CollapsibleAside
                          summary={`${message.articles.length} article${
                            message.articles.length === 1 ? "" : "s"
                          }`}
                          defaultExpanded
                        >
                          <AskArticleGroups
                            articles={message.articles}
                            content={message.content}
                            entrance={!restoredIds.has(message.id)}
                          />
                        </CollapsibleAside>
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
                down instead of being left behind by it — and both arrives and
                leaves on the same curve, collapsing its height rather than
                just fading, so the composer's travel stays one movement in
                either direction.

                Serif and unhurried: it is the only thing on the page that is
                not an instrument. */}
            {/* `initial={false}` belongs here rather than on the child.
                On the child it means "never animate in", which is why New
                chat used to snap the greeting into place at full height while
                the composer was still travelling. Here it means only "do not
                animate the greeting that is present when the page first
                opens" — which was the whole intent — and every later arrival
                animates like the departure does. */}
            <AnimatePresence initial={false}>
              {empty && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{
                    opacity: 1,
                    height: "auto",
                    transition: reduceMotion ? HERO_ASIDE_INSTANT : HERO_ASIDE_ENTER,
                  }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    transition: reduceMotion ? HERO_ASIDE_INSTANT : HERO_ASIDE_EXIT,
                  }}
                  className="overflow-hidden"
                >
                  {/* The gap below the greeting moved in here off the animated
                      element. Animating `marginBottom` alongside height meant
                      naming a pixel value, which would have thrown away the
                      responsive `md:` step; inside an `overflow-hidden` box
                      the margin counts toward the height being animated
                      anyway, so collapsing the height takes it with it. */}
                  <div className="mb-10 text-center md:mb-12">
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <ChatInput
              onSend={handleSend}
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
            {/* Same arrangement as the greeting above: the presence guard
                skips only the first page load, the margin sits inside the
                animated box, and the hint expands and fades on the composer's
                own curve rather than appearing fully formed beneath it. */}
            <AnimatePresence initial={false}>
              {empty && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{
                    opacity: 1,
                    height: "auto",
                    transition: reduceMotion ? HERO_ASIDE_INSTANT : HERO_ASIDE_ENTER,
                  }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    transition: reduceMotion ? HERO_ASIDE_INSTANT : HERO_ASIDE_EXIT,
                  }}
                  className="overflow-hidden"
                >
                  <div className="mt-8 flex justify-center md:mt-10">
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
                              Prioritises your archive, the web only for the gaps. The
                              answer says which is which.
                            </p>
                          </div>
                        </div>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
