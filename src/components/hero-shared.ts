/**
 * The empty-state transition shared by Search and Ask.
 *
 * Both pages open the same way — a single input sitting low on an otherwise
 * bare page — and then part company. Search pulls its box *up* to the header
 * to make room for results below it; Ask pushes its composer *down* to the
 * foot of the viewport, because a conversation grows above the thing you type
 * into. Same gesture, opposite direction, so the constants live here rather
 * than being written twice and drifting.
 */

/**
 * How far the input sits below the header while the page is empty.
 *
 * svh, not dvh. The empty page is tall enough to scroll on a phone, and
 * scrolling retracts the browser's URL bar — which changes dvh, which would
 * re-run the transition and drift the input under the reader's thumb. svh is
 * pinned to the URL-bar-visible height and never moves.
 */
export const HERO_OFFSET = "20svh";

/**
 * Sitting low, the input pulls in off the full content column, which at 80rem
 * reads as a page banner rather than something to type into. Both ends are
 * concrete lengths because `none` would not interpolate.
 */
export const HERO_WIDTH_LOW = "48rem";

/** The content column's own max-w-7xl, i.e. no visible constraint. */
export const HERO_WIDTH_TOP = "80rem";

/**
 * The same curve twice: the input moves on a CSS transition, everything around
 * it on Motion, and they have to agree or the sequence stops reading as one
 * gesture. Delays elsewhere are measured against the 400ms here, so changing
 * this duration means revisiting them.
 */
export const heroEase =
  "duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none";

export const heroEaseCurve: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

export const heroSpacer = `transition-[height] ${heroEase}`;

/** Shared by the header and the content below it, so the two stay aligned. */
export const contentColumn = "w-full max-w-7xl mx-auto px-4 md:px-6";
