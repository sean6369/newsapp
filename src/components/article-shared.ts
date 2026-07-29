export const feedColor: Record<string, string> = {
  tech: "text-green-600",
  ai: "text-orange-500",
  singapore: "text-red-600",
  world: "text-neutral-900 dark:text-neutral-100",
  asia: "text-purple-600",
  finance: "text-blue-600",
};

export function scoreColor(score: number | null): string {
  if (score === null) return "text-muted";
  if (score >= 7) return "text-green-600";
  if (score >= 4) return "text-orange-500";
  return "text-red-500";
}

/**
 * Rows past this point in a replaced list skip the entrance animation — they
 * are below the fold, so all it would buy is jank.
 */
export const ENTRANCE_LIMIT = 18;

/** Staggered fade-and-rise played when a feed's rows are replaced. */
export const entranceInitial = { opacity: 0, y: 12 };
export const entranceAnimate = { opacity: 1, y: 0 };

export function entranceTransition(index: number) {
  const ease: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
  const delay = Math.min(index * 0.04, 0.25);
  return {
    opacity: { duration: 0.3, ease, delay },
    y: { duration: 0.3, ease, delay },
  };
}

export const slideVariants = {
  enter: (dir: number) => ({ x: dir * 30, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -30, opacity: 0 }),
};
