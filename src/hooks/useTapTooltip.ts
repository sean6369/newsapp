"use client";

import { useEffect, useId, useState } from "react";

/**
 * A tooltip a finger can open.
 *
 * react-aria's tooltip opens on hover and on keyboard focus only, so on a
 * phone the trigger does nothing at all. Worse, it *closes* the tooltip on
 * every pointerdown, which is why a bare click toggle is not enough: the
 * pointerdown shuts it, the click reopens it, and a second tap can never
 * dismiss it. Turning `shouldCloseOnPress` off hands the press to the click
 * toggle alone, which still closes a hovered tooltip on a mouse click.
 *
 * Nothing else dismisses a tooltip on touch — there is no hover to end, and
 * tapping blank page does not blur the trigger on iOS — so a tap anywhere
 * outside the trigger closes it as well.
 *
 * Spread `rootProps` on `Tooltip` and `triggerProps` on `Tooltip.Trigger`.
 */
export function useTapTooltip() {
  const [isOpen, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(`[data-tap-tooltip="${id}"]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen, id]);

  return {
    rootProps: { isOpen, onOpenChange: setOpen, shouldCloseOnPress: false },
    triggerProps: {
      "data-tap-tooltip": id,
      onClick: () => setOpen((open) => !open),
    },
  };
}
