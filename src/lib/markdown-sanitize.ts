import { defaultSchema, type Options as Schema } from "rehype-sanitize";

/**
 * Embed hosts an article body may point an `<iframe>` at.
 *
 * One list, three enforcement points, because each catches what the others
 * cannot: `clipper.ts` tells Readability to preserve these embeds instead of
 * stripping them, `articleSchema` below decides which survive rendering, and
 * `EmbedIframe` decides which get mounted. They must agree — a host added to
 * the clipper alone produces embeds that are silently dropped downstream.
 */
export const ALLOWED_EMBED_HOSTS = ["flo.uri.sh", "datawrapper.dwcdn.net"];

/**
 * The same allowlist as a pattern, for Readability's `allowedVideoRegex`.
 */
export const ALLOWED_EMBED_PATTERN = new RegExp(
  ALLOWED_EMBED_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")
);

/** `https://host/` prefixes, for matching a full `src` in the schema below. */
const embedSrcPatterns = ALLOWED_EMBED_HOSTS.map(
  (h) => new RegExp(`^https://${h.replace(/\./g, "\\.")}/`)
);

/**
 * What markup is allowed to survive from a clipped article into the DOM.
 *
 * Every renderer of `articles.content` runs `rehype-raw`, whose entire job is
 * to promote raw HTML inside markdown into real elements. It cannot distinguish
 * a tag the clipper wrote on purpose (the embeds above) from one that was
 * ordinary prose on the source page — an article *about* HTML quotes tags, and
 * Turndown does not escape `<`, so those quotes reach storage as live markup.
 * `clipper.ts` now escapes them at the source, but rows clipped before that fix
 * are still in the table, and Readability has never claimed to be a sanitizer.
 * So the allowlist runs at render time, where it covers every row regardless of
 * when it was stored.
 *
 * Restricting `src` by pattern rather than just permitting the attribute is
 * what keeps this a real boundary: an `<iframe>` pointing anywhere else keeps
 * the tag but loses its `src`, so it loads nothing.
 */
export const articleSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "iframe"],
  attributes: {
    ...defaultSchema.attributes,
    iframe: [
      ["src", ...embedSrcPatterns],
      "width",
      "height",
      "frameBorder",
      "scrolling",
      "loading",
    ],
  },
};
