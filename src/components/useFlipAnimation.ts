"use client";

/* eslint-disable react-hooks/refs -- the latest `enabled`/`onSettled` are stashed during render on purpose, so the layout effect can read them without re-running */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface Point {
  top: number;
  left: number;
}

/**
 * Layout position, measured the way FLIP needs it.
 *
 * Deliberately not getBoundingClientRect: positions are compared against ones
 * captured in an earlier render, and viewport coordinates drift with the
 * scroll offset (so scrolling to a "load more" button would make every row on
 * screen slide by the distance scrolled). Offsets are relative to the
 * positioned container and ignore transforms, so a row measured mid-entrance
 * reports where it will settle rather than where it currently sits.
 */
function measure(node: HTMLElement): Point {
  return { top: node.offsetTop, left: node.offsetLeft };
}

/**
 * Manual FLIP (First–Last–Invert–Play) movement animation.
 *
 * Register each animated element with the returned setter. Whenever `deps`
 * change, every element that survived the render slides from where it used to
 * be to where it now is. Elements that mounted or unmounted this render are
 * left alone — their entrance is the caller's business.
 */
export function useFlipAnimation({
  enabled,
  deps,
  onSettled,
}: {
  /** False for renders that remount rows, where sliding would be wrong. */
  enabled: boolean;
  /** Layout inputs. A change re-measures and plays the animation. */
  deps: React.DependencyList;
  /** Fired once a row finishes moving. Not fired when the move is cancelled. */
  onSettled?: (key: string, node: HTMLElement) => void;
}) {
  const nodes = useRef<Map<string, HTMLElement>>(new Map());
  const prevPositions = useRef<Map<HTMLElement, Point>>(new Map());
  const running = useRef<Map<HTMLElement, Animation>>(new Map());

  // Read inside the layout effect, so callers can pass fresh values every
  // render without re-running it.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const setNode = useCallback((key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    const prev = prevPositions.current;

    // Cancel in-progress animations (before paint, so no visual flash)
    running.current.forEach((anim) => anim.cancel());
    running.current.clear();

    // Capture current layout positions
    const positions = new Map<HTMLElement, Point>();
    const keyByNode = new Map<HTMLElement, string>();
    nodes.current.forEach((node, key) => {
      positions.set(node, measure(node));
      keyByNode.set(node, key);
    });

    if (enabledRef.current && prev.size > 0) {
      positions.forEach((now, node) => {
        const before = prev.get(node);
        if (!before) return;

        const dx = before.left - now.left;
        const dy = before.top - now.top;
        // Offsets are rounded to whole pixels, so sub-pixel reflow shows up as
        // a 1px delta that is not worth animating.
        if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;

        const anim = node.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 450, easing: "cubic-bezier(0.33, 1.15, 0.5, 1)" },
        );

        running.current.set(node, anim);

        const key = keyByNode.get(node);
        anim.finished
          .then(() => {
            running.current.delete(node);
            if (key) onSettledRef.current?.(key, node);
          })
          .catch(() => {}); // ignore cancel rejection
      });
    }

    prevPositions.current = positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller owns the layout deps
  }, deps);

  // Keep the captured positions fresh on resize (recapture, don't animate)
  useEffect(() => {
    const handleResize = () => {
      running.current.forEach((anim) => anim.cancel());
      running.current.clear();
      const positions = new Map<HTMLElement, Point>();
      nodes.current.forEach((node) => {
        positions.set(node, measure(node));
      });
      prevPositions.current = positions;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return setNode;
}
