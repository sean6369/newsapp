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

  // Skip paywalled articles (e.g. Straits Times premium)
  if (html.includes('"isAccessibleForFree":false') || html.includes('"isAccessibleForFree": false')) {
    console.warn(`[clipper] Paywalled article, skipping: ${url}`);
    return null;
  }

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

  if (markdown.length < 100) {
    console.warn(`[clipper] Content too short for ${url} (${markdown.length} chars)`);
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
