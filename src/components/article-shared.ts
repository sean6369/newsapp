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

export const slideVariants = {
  enter: (dir: number) => ({ x: dir * 30, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -30, opacity: 0 }),
};
