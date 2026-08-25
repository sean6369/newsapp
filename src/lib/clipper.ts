import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
// @ts-expect-error -- no type declarations for turndown-plugin-gfm
import { gfm } from "turndown-plugin-gfm";
import { ALLOWED_EMBED_PATTERN } from "./markdown-sanitize";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// GFM support: tables, strikethrough, task lists
turndown.use(gfm);

/**
 * Text a publisher leaves where the rest of the article should have been.
 *
 * Independent evidence of truncation, and stronger than any length rule: it
 * catches a teaser long enough to clear the character floor in
 * `clipArticleContent`. Only add a phrase a *complete* article would never
 * contain — these were checked against 70 fully-clipped Straits Times
 * articles, none of which matched, so the markers cost nothing in false
 * rejections.
 *
 * Kept as plain substrings rather than a hand-written pattern because they are
 * matched two ways: as a regex against markdown the clipper has just produced,
 * and as SQL against bodies already stored (`getClipsContaining`). One list
 * feeds both, so an added phrase takes effect in both places at once.
 *
 * Deliberately literal — no regex metacharacters, no SQL wildcards — since
 * each is interpolated into a pattern by its respective caller.
 */
export const TRUNCATION_MARKER_PHRASES = [
  "Get unlimited access to exclusive stories",
  "incisive insights from the ST newsroom",
  "sign up or log in to continue reading",
] as const;

/** The phrases above, for testing text the clipper is holding in memory. */
const TRUNCATION_MARKERS = new RegExp(TRUNCATION_MARKER_PHRASES.join("|"), "i");

/**
 * Escape `<` in text so quoted markup stays quoted.
 *
 * Turndown escapes the markdown syntax characters (`*`, backtick, `[`, `_`, …)
 * but has no rule for `<`, and Readability hands it text with entities already
 * decoded. So a page that merely *writes about* HTML — "the payload is
 * `<img src=x onerror=…>`" — stores a literal tag, and `rehype-raw` downstream
 * promotes it to a real element: the words vanish from the sentence and become
 * markup in the reader.
 *
 * `\<` is a CommonMark backslash escape, so the character survives as text
 * through every renderer. Applied only to text nodes — Turndown passes code
 * through unescaped, so fenced blocks are untouched, and the `keep-iframes`
 * rule below emits its tag as a replacement rather than as escaped text.
 */
const escapeMarkdown = turndown.escape.bind(turndown);
turndown.escape = (text: string) => escapeMarkdown(text).replace(/</g, "\\<");

// Preserve trusted iframes as raw HTML in markdown
turndown.addRule("keep-iframes", {
  filter: (node) => node.nodeName === "IFRAME",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const src = el.getAttribute("src") || "";
    if (!src) return "";
    return `\n\n<iframe src="${src}" width="100%" height="400" frameborder="0" scrolling="no"></iframe>\n\n`;
  },
});

// Remove images with no src or data URIs (useless in markdown)
turndown.addRule("remove-bad-images", {
  filter: (node) => {
    if (node.nodeName !== "IMG") return false;
    const src = node.getAttribute("src") || "";
    return !src || src.startsWith("data:");
  },
  replacement: () => "",
});

// Convert <details>/<summary> to a heading + content block
turndown.addRule("details-summary", {
  filter: "details",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const summary = el.querySelector("summary");
    const summaryText = summary ? summary.textContent?.trim() || "" : "";

    // Remove the summary from the content to avoid duplication
    if (summary) summary.remove();
    const innerMarkdown = turndown.turndown(el.innerHTML).trim();

    return `\n\n**${summaryText}**\n\n${innerMarkdown}\n\n`;
  },
});

export interface ClipResult {
  content: string;
  title: string;
  /**
   * The page's own one-line description, when it publishes one.
   *
   * Feed articles arrive with a summary from the RSS item or the TLDR digest,
   * so nothing here used to need it. A pasted link has no such envelope — the
   * URL is all the reader gives us — and this is the only summary available
   * that costs neither a model call nor a guess. Empty when the page offers
   * none; `lib/library.ts` falls back to the body text.
   */
  excerpt: string;
}

async function resolveUrl(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return res.url;
  } catch {
    return null;
  }
}

async function clipTweet(url: string): Promise<ClipResult | null> {
  try {
    const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[clipper] oEmbed ${response.status} for ${url}`);
      return null;
    }

    const data = await response.json();

    // Extract external links from the tweet HTML (t.co shortened URLs)
    const tcoLinks = (data.html as string).match(/https?:\/\/t\.co\/\w+/g) || [];

    // Try to resolve t.co links and clip the linked article instead
    for (const tcoUrl of tcoLinks) {
      const resolved = await resolveUrl(tcoUrl);
      if (!resolved) continue;

      // Skip links that point back to twitter/x.com (e.g. media, quoted tweets)
      if (resolved.includes("x.com/") || resolved.includes("twitter.com/")) continue;

      console.log(`[clipper] Tweet links to ${resolved}, clipping that instead`);
      const articleResult = await clipArticleContent(resolved);
      if (articleResult) return articleResult;
    }

    // No external article found — oEmbed only gives truncated tweet text,
    // so return null to fall back to the TLDR summary (marked as *summary)
    console.warn(`[clipper] No external link in tweet, skipping oEmbed fallback: ${url}`);
    return null;
  } catch (error) {
    console.warn(`[clipper] Failed to clip tweet ${url}:`, error);
    return null;
  }
}

async function clipArticleContent(url: string): Promise<ClipResult | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!response.ok) {
    console.warn(`[clipper] ${response.status} for ${url}`);
    return null;
  }

  const html = await response.text();

  /**
   * Whether the page *declares* itself paywalled, which is not the same as
   * withholding the article.
   *
   * `isAccessibleForFree: false` is a metering declaration aimed at crawlers —
   * "this counts against a quota" — and a metered publisher sets it on pages
   * whose body it ships in full anyway. CNN does exactly that: the flag is
   * present and all ~5,600 characters of the article are in the HTML, which is
   * why those URLs read fine in a browser but used to save as link-only.
   *
   * So the flag only raises the bar the extraction has to clear (below); it no
   * longer decides on its own. A publisher that really does gate — Straits
   * Times premium — is still caught there, because what it returns is signup
   * chrome and a single opening sentence, not an article.
   */
  const declaredPaywalled =
    html.includes('"isAccessibleForFree":false') || html.includes('"isAccessibleForFree": false');

  const dom = new JSDOM(html, { url });

  // Replace Flourish/Datawrapper embeds with iframes before Readability strips them
  for (const embed of dom.window.document.querySelectorAll(".flourish-embed")) {
    const dataSrc = embed.getAttribute("data-src") || "";
    if (dataSrc) {
      const id = dataSrc.split("?")[0];
      const iframe = dom.window.document.createElement("iframe");
      iframe.src = `https://flo.uri.sh/${id}/embed`;
      iframe.width = "100%";
      iframe.height = "400";
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("scrolling", "no");
      embed.replaceWith(iframe);
    }
  }

  // Promote <noscript> images into the DOM so Readability can see them
  for (const noscript of dom.window.document.querySelectorAll("noscript")) {
    const imgs = noscript.querySelectorAll("img");
    if (imgs.length > 0) {
      for (const img of imgs) {
        noscript.parentNode?.insertBefore(img, noscript);
      }
      noscript.remove();
    }
  }

  // Extract og:image before Readability modifies the DOM
  const ogImage = dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
  const ogDescription =
    dom.window.document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    dom.window.document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    "";

  const reader = new Readability(dom.window.document, {
    allowedVideoRegex: ALLOWED_EMBED_PATTERN,
  });
  const article = reader.parse();

  if (!article || !article.content) {
    console.warn(`[clipper] Readability failed for ${url}`);
    return null;
  }

  // Merge fragmented <p> tags inside the same parent <div>
  // (e.g. Straits Times wraps sentence fragments in separate <p> tags)
  const contentDom = new JSDOM(article.content);
  const doc = contentDom.window.document;
  for (const div of doc.querySelectorAll("div")) {
    const children = Array.from(div.childNodes);
    let merged = "";
    let firstP: Element | null = null;

    for (const child of children) {
      if (child.nodeType === 8) continue; // skip HTML comments
      if (child.nodeType === 1 && (child as Element).tagName === "P") {
        const text = (child as Element).innerHTML.trim();
        if (!firstP) {
          firstP = child as Element;
          merged = text;
        } else {
          // Check if previous merged text ends mid-sentence (no terminal punctuation)
          const prevEndsWithPunctuation = merged.match(/[.!?:;]\s*$/);
          const raw = (child as Element).textContent || "";
          const startsLower = raw.match(/^[\s,;.a-z]/);

          if (!prevEndsWithPunctuation || startsLower) {
            // Continuation — previous text didn't end a sentence, or this starts lowercase
            merged += raw.startsWith(" ") ? raw : ` ${raw}`;
            child.remove();
          } else {
            // New sentence — flush previous merge and start fresh
            if (firstP) firstP.innerHTML = merged;
            firstP = child as Element;
            merged = text;
          }
        }
      } else {
        // Non-<p> node — flush
        if (firstP) {
          firstP.innerHTML = merged;
          firstP = null;
          merged = "";
        }
      }
    }
    if (firstP) firstP.innerHTML = merged;
  }

  let markdown = turndown.turndown(doc.body.innerHTML);

  // Fix stray spaces before punctuation left by fragmented <p> merging
  markdown = markdown.replace(/ +([.,;:!?])/g, "$1");

  // Clean up broken toggle links: [\n### Heading\n](#) → ### Heading
  markdown = markdown.replace(/\[\s*\n*(#{1,6}\s+[^\n]+)\n*\]\(#\)/g, "$1");

  /**
   * A gated teaser clears the ordinary floor easily, so a page that declared
   * itself paywalled has to produce a full article's worth of text to be
   * believed. Measured across the sources this app actually pulls: a Straits
   * Times teaser lands between 350 and 1,100 characters, an ordinary CNA
   * article between 1,900 and 2,800, and a flagged-but-complete CNN article at
   * ~5,600. The threshold sits in that gap.
   *
   * Pages that never set the flag keep the original floor, so nothing that
   * clips today can start failing because of this.
   */
  const minChars = declaredPaywalled ? 1500 : 100;
  if (markdown.length < minChars) {
    const reason = declaredPaywalled ? "Paywalled" : "Content too short";
    console.warn(`[clipper] ${reason} for ${url} (${markdown.length} chars)`);
    return null;
  }

  // Checked after the floor rather than instead of it: a publisher that cuts
  // an article off usually does it silently, so most teasers never carry a
  // marker and only their length gives them away. This catches the rest.
  if (TRUNCATION_MARKERS.test(markdown)) {
    console.warn(`[clipper] Truncated at paywall for ${url} (${markdown.length} chars)`);
    return null;
  }

  // Prepend og:image as hero image for CNA/ST articles
  // (their hero images are loaded via JS, so Readability misses them)
  const isLocalNews = url.includes("channelnewsasia.com") || url.includes("straitstimes.com");
  if (isLocalNews && ogImage) {
    // Extract base filename to avoid duplicating the same photo with different crops
    const ogBaseName = ogImage.split("/").pop()?.split("?")[0] || "";
    if (!markdown.includes(ogBaseName)) {
      markdown = `![](${ogImage})\n\n${markdown}`;
    }
  }

  return {
    content: markdown,
    title: article.title || "",
    // Readability's excerpt is usually the meta description anyway, but it
    // falls back to the article's first paragraph when the page has none,
    // which is the better summary of the two.
    excerpt: (article.excerpt || ogDescription).trim(),
  };
}

export async function clipArticle(url: string): Promise<ClipResult | null> {
  try {
    if (url.includes("x.com/") || url.includes("twitter.com/")) {
      return clipTweet(url);
    }

    // Skip clipping HN discussion pages — self-posts are threads, not articles
    if (url.includes("news.ycombinator.com/item")) {
      return null;
    }

    return await clipArticleContent(url);
  } catch (error) {
    console.warn(`[clipper] Failed to clip ${url}:`, error);
    return null;
  }
}
