import { Fragment } from "react";
import { HIGHLIGHT_START, HIGHLIGHT_END } from "@/lib/types";

/**
 * Render text produced by `ts_headline`, turning the highlight sentinels into
 * <mark> elements. Postgres does not escape the source text, and article bodies
 * come from third-party feeds, so the string is split into React text nodes
 * rather than injected as HTML.
 */
/**
 * An inline background paints the font's content area — ascent plus descent —
 * not the line box, so the band sits low under text with no descenders (an
 * all-caps match like "MRT"). Padding on an inline element grows the background
 * without affecting line height, so a heavier top pad recentres it on the
 * glyphs. The correction is font-specific, hence a variant per context.
 */
const MARK_BASE = "bg-accent/20 text-inherit rounded-[0.2em]";

const markVariants = {
  /** Newsreader (serif) titles: deep descender, needs the larger correction. */
  title: `${MARK_BASE} px-[0.16em] pt-[0.12em] pb-[0.01em]`,
  /** Sans body text at text-sm: shallower descender, a light nudge is enough. */
  body: `${MARK_BASE} px-[0.14em] pt-[0.06em] pb-[0.01em]`,
} as const;

export function HighlightedText({
  text,
  variant = "body",
}: {
  text: string;
  variant?: keyof typeof markVariants;
}) {
  const parts = text.split(HIGHLIGHT_START).flatMap((chunk, i) => {
    if (i === 0) return [{ text: chunk, hit: false }];
    const [hit, ...rest] = chunk.split(HIGHLIGHT_END);
    return [
      { text: hit, hit: true },
      { text: rest.join(HIGHLIGHT_END), hit: false },
    ];
  });

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.hit ? (
            <mark className={markVariants[variant]}>{part.text}</mark>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The matched-context block shown under a search result. The left rule ties it
 * to the article card above it, so it reads as belonging to that result rather
 * than floating between two of them.
 */
export function SearchSnippet({ snippet }: { snippet: string }) {
  return (
    <p className="text-sm text-muted leading-relaxed ml-5 mt-1.5 pl-4 border-l-2 border-border">
      <HighlightedText text={snippet} />
    </p>
  );
}
