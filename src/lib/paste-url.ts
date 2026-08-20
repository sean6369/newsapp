/**
 * Reading a URL out of pasted text.
 *
 * Its own module because both sides need it and they cannot share `lib/library`
 * — that one reaches for jsdom, which has no business in a browser bundle. The
 * library page uses it to show which site it is clipping before the request
 * comes back; the route uses it as the authority on what actually gets stored.
 */

/**
 * The first http(s) URL in pasted text, normalised, or null.
 *
 * A paste is rarely just a URL — it arrives with a trailing newline, a title
 * in front of it from a "copy link" menu, or tracking parameters bolted on the
 * end. Only the last of those changes what gets stored: `source_url` is
 * uniquely indexed, so leaving `?utm_source=…` on would let the same article
 * be clipped twice under two URLs that differ only in how it was shared.
 */
export function parsePastedUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/);
  if (!match) return null;

  try {
    const url = new URL(match[0]);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_[ce]id$|igshid$|ref$|ref_src$|si$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}
