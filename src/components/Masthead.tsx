"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The masthead, delivered by rabbits.
 *
 * On a fresh page load a line of pixel rabbits hops in from the right edge of
 * the header, each carrying one letter of the title on its back. They set off
 * in reading order — the one carrying the S runs the furthest — and stop where
 * their letter belongs, so the two words assemble from the left. A beat after
 * the last letter lands, the rabbits slip out from under them and hop away
 * through the left edge, leaving the title standing.
 *
 * Two things about how it's built.
 *
 * The stops can't be hard-coded: they are wherever the browser's own kerning
 * puts each glyph at the current font size, which changes with the breakpoint
 * and with whether Newsreader has loaded yet. So the row is rendered once,
 * hidden, purely to be measured.
 *
 * And the run itself is CSS, not JS. Everything moves on transform and opacity
 * with a fixed hop period, which is exactly the shape a compositor can take
 * off the main thread — this page is also fetching and painting the feed while
 * the rabbits are crossing it, and a JS-driven animation loses that race every
 * time. React measures the letters once, writes the numbers out as custom
 * properties, and then does nothing until it's time to take the rabbits down.
 */

const TITLE = "Sean’s Newsletter";
const CHARS = [...TITLE];

/* -------------------------------------------------------------------------
 * The sprite
 *
 * Two frames of a hop cycle, traced off a pixel-art rabbit: `#` outline, `o`
 * white fur, `p` pink inner ear, `.` nothing. Both frames hang from the same
 * top row — the ears stay put under the letter riding on the rabbit's back
 * while the legs stretch out below, which is why `leap` is the taller grid.
 *
 * The art is kept exactly as traced, facing the way the original does, and
 * flipped when it is drawn: the legs kick out behind the rabbit, so mirroring
 * is what turns a leap to the right into a leap to the left, the way this
 * parade is travelling.
 * ------------------------------------------------------------------------- */

const SPRITE_COLS = 11;

const LEAP = [
  "....##.##..",
  "...#oo#oo#.",
  "...#op#op#.",
  "...#op#op#.",
  "...#op#op#.",
  "..#ooooooo#",
  "..#oo#oo#o#",
  "..#oo#oo#o#",
  "..#oooo#oo#",
  ".#o#ooooo#.",
  "#ooo######.",
  "##ooooo#o#.",
  "#ooo######.",
  "#oo#.......",
  "####.......",
];

const SIT = [
  "....##.##..",
  "...#oo#oo#.",
  "...#op#op#.",
  "...#op#op#.",
  "...#op#op#.",
  "..#ooooooo#",
  "..#oo#oo#o#",
  ".##oo#oo#o#",
  "#o#oooo#oo#",
  "##o#ooooo#.",
  "#ooo#####..",
  "#oo#oo#o#..",
  "#########..",
];

/** Both frames laid out side by side, so one shift of a frame's width swaps them. */
const SHEET_ROWS = Math.max(LEAP.length, SIT.length);
const SHEET = [
  [LEAP, 0],
  [SIT, SPRITE_COLS],
] as const;

/**
 * One `<path>` per colour, with each row's cells merged into runs. A rabbit is
 * about 90 lit pixels; drawn as one rect apiece that would be 90 nodes in the
 * DOM sixteen times over, so they collapse to three paths, defined once and
 * referenced by every rabbit.
 */
function spritePath(colour: "#" | "o" | "p") {
  let d = "";

  for (const [grid, dx] of SHEET) {
    grid.forEach((row, y) => {
      const flipped = [...row].reverse();
      let run = 0;
      for (let x = 0; x <= flipped.length; x++) {
        if (flipped[x] === colour) {
          run++;
          continue;
        }
        if (run > 0) {
          d += `M${x - run + dx} ${y}h${run}v1h-${run}z`;
          run = 0;
        }
      }
    });
  }

  return d;
}

const SPRITE_PATHS = [
  { d: spritePath("o"), fill: "var(--card-bg)" },
  { d: spritePath("p"), fill: "#f4a6dc" },
  { d: spritePath("#"), fill: "var(--foreground)" },
];

/* -------------------------------------------------------------------------
 * The timings
 * ------------------------------------------------------------------------- */

/**
 * Travel speed in px per second — one speed for every rabbit on the way in,
 * one for the way out.
 */
const SPEED_IN = 290;
const SPEED_OUT = 400;

/**
 * Seconds per hop, also the same for everyone, so a rabbit with a short trip
 * doesn't have to scurry to keep up with one crossing the whole header. Speed
 * times beat is the stride: how much ground one hop covers.
 */
const BEAT_IN = 0.3;
const BEAT_OUT = 0.26;

/** How high a hop arcs, in px. */
const RISE = 22;

/**
 * Gap between one letter landing and the next — the only thing setting how
 * quickly the title fills in.
 */
const LAND_GAP = 0.13;

/** The finished title held for a moment before anyone lets go. */
const HOLD = 0.3;
const EXIT_STAGGER = 0.03;

/** How far past the header's edge a rabbit starts from, and disappears to. */
const OFFSTAGE = 30;

/**
 * Once per page load. Back-navigation remounts the feed, and a masthead that
 * reassembled itself every time you came back from an article would be a tax
 * on reading rather than a welcome.
 */
let hasPlayed = false;

type StyleVars = React.CSSProperties & Record<string, string | number>;

interface Metrics {
  width: number;
  /** Centre of each glyph, indexed alongside CHARS; -1 for the space. */
  centres: number[];
}

/**
 * A trip, rounded up to whole hops.
 *
 * Fixing both the speed and the beat fixes the stride too, and a journey is
 * rarely a whole number of strides — so the rabbit starts however far back the
 * next whole hop puts it, rather than landing halfway through an arc. That
 * slack is spent offstage, where there is nothing to see.
 */
function trip(distance: number, speed: number, beat: number) {
  const stride = speed * beat;
  const count = Math.max(2, Math.ceil(distance / stride));
  return { count, span: count * stride, duration: count * beat };
}

/**
 * Turn measured glyph positions into a departure board — who leaves when, how
 * far they travel, how many hops that takes — and hand it over as the custom
 * properties the stylesheet animates against.
 */
function planRun(metrics: Metrics) {
  const first = metrics.centres.find((centre) => centre >= 0) ?? 0;
  const queue = metrics.centres.filter((centre) => centre >= 0).length;

  // The leftmost letter has the furthest to come, so its rabbit sets off first
  // and everything else is timed off the moment it arrives.
  const lead = trip(metrics.width - first + OFFSTAGE, SPEED_IN, BEAT_IN).duration;
  const settled = lead + (queue - 1) * LAND_GAP;

  let order = 0;
  let total = settled;

  const slots = metrics.centres.map((centre) => {
    if (centre < 0) return null;

    const inbound = trip(metrics.width - centre + OFFSTAGE, SPEED_IN, BEAT_IN);
    const outbound = trip(centre + OFFSTAGE, SPEED_OUT, BEAT_OUT);

    // Solved backwards from the landing. A rabbit further right has less ground
    // to cover, which is exactly what puts its departure later — and because
    // every start is derived from its own trip at one shared speed, the queue
    // stays evenly spaced and in order the whole way across.
    const delay = lead + order * LAND_GAP - inbound.duration;
    const outDelay = settled + HOLD + order * EXIT_STAGGER;
    total = Math.max(total, outDelay + outbound.duration);
    order++;

    const vars: StyleVars = {
      "--mh-from": `${Math.round(inbound.span)}px`,
      "--mh-in": `${inbound.duration.toFixed(2)}s`,
      "--mh-delay": `${delay.toFixed(2)}s`,
      "--mh-hops-in": inbound.count,
      "--mh-to": `${-Math.round(outbound.span)}px`,
      "--mh-out": `${outbound.duration.toFixed(2)}s`,
      "--mh-out-delay": `${outDelay.toFixed(2)}s`,
      "--mh-hops-out": outbound.count,
    };
    return vars;
  });

  return { slots, total };
}

export function Masthead() {
  const rootRef = useRef<HTMLElement>(null);
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [run, setRun] = useState<ReturnType<typeof planRun> | null>(null);
  const [phase, setPhase] = useState<"measuring" | "playing" | "done">(
    hasPlayed ? "done" : "measuring",
  );

  // Measure the hidden row, then hand the numbers to the stylesheet. Waiting on
  // the font matters: measured in the fallback face, every rabbit would stop
  // slightly wide of where its letter ends up once Newsreader swaps in.
  useEffect(() => {
    if (phase !== "measuring") return;
    let cancelled = false;
    let measured = false;

    // Called by whichever of the two triggers below gets there first, and only
    // ever acted on once.
    const measure = () => {
      const root = rootRef.current;
      if (cancelled || measured || !root) return;
      measured = true;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPhase("done");
        return;
      }

      const centres = slotRefs.current.map((slot) =>
        slot?.dataset.glyph === "true" ? slot.offsetLeft + slot.offsetWidth / 2 : -1,
      );

      // One frame's grace before the parade starts, so it isn't competing with
      // the feed's own first paint for the same few milliseconds.
      requestAnimationFrame(() => {
        if (cancelled) return;
        setRun(planRun({ width: root.clientWidth, centres }));
        setPhase("playing");
      });
    };

    // Whichever comes first. A font that never resolves — or a browser with no
    // FontFaceSet at all — would otherwise leave the header stuck on the hidden
    // measuring pass, i.e. with no title at all.
    const fallback = setTimeout(measure, 1200);
    document.fonts?.ready.then(measure, measure);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [phase]);

  // The rabbits are gone by now; drop back to plain text so nothing is left
  // animating behind the feed.
  useEffect(() => {
    if (phase !== "playing" || !run) return;
    const timer = setTimeout(() => {
      hasPlayed = true;
      setPhase("done");
    }, run.total * 1000 + 200);
    return () => clearTimeout(timer);
  }, [phase, run]);

  const playing = phase === "playing" && run !== null;

  return (
    <header
      ref={rootRef}
      className="mh-parade relative overflow-hidden pt-6 pb-11 mb-2"
      style={
        {
          "--mh-rise": `${RISE}px`,
          "--mh-frame": `${SPRITE_COLS}px`,
          "--mh-hop-in": `${BEAT_IN}s`,
          "--mh-hop-out": `${BEAT_OUT}s`,
        } as StyleVars
      }
    >
      <h1 className="sr-only">{TITLE}</h1>
      {playing && <SpriteDefs />}
      <div
        aria-hidden
        className="font-serif text-2xl md:text-4xl font-medium leading-none whitespace-nowrap"
        style={{ visibility: phase === "measuring" ? "hidden" : undefined }}
      >
        {CHARS.map((char, index) => {
          const vars = playing ? run.slots[index] : null;
          const glyph = char === " " ? " " : char;

          if (!vars) {
            return (
              <span
                key={index}
                ref={(node) => {
                  slotRefs.current[index] = node;
                }}
                data-glyph={char !== " "}
                className="mh-slot"
              >
                {glyph}
              </span>
            );
          }

          return (
            <span key={index} className="mh-slot" style={vars}>
              <span className="mh-ride">
                <span className="mh-hop-in">
                  {glyph}
                  <span className="mh-rabbit">
                    <span className="mh-hop-out">
                      <svg
                        className="mh-sprite"
                        viewBox={`0 0 ${SPRITE_COLS} ${SHEET_ROWS}`}
                        role="presentation"
                      >
                        <g className="mh-frames">
                          <use href="#mh-rabbit" />
                        </g>
                      </svg>
                    </span>
                  </span>
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </header>
  );
}

/** The sprite sheet itself, in the document once, referenced by every rabbit. */
function SpriteDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <g id="mh-rabbit">
          {SPRITE_PATHS.map((path) => (
            <path key={path.fill} d={path.d} style={{ fill: path.fill }} />
          ))}
        </g>
      </defs>
    </svg>
  );
}
