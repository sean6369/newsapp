import { NextRequest, NextResponse } from "next/server";
import {
  getLibraryArticles,
  getArticleBySourceUrl,
  getArticleBySlug,
  insertArticle,
  addToLibrary,
  removeFromLibrary,
  deleteArticle,
} from "@/lib/db/queries";
import { LIBRARY_FEED } from "@/lib/types";
import { buildLibraryClip, isBlockedHost } from "@/lib/library";
import { parsePastedUrl } from "@/lib/paste-url";
import { LOG_TITLE_LEN } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("search") || undefined;
  const articles = await getLibraryArticles({ search });
  return NextResponse.json({ articles });
}

/**
 * Clip a pasted link into the library.
 *
 * Fetching the page takes as long as the page takes, so this is deliberately
 * one slow request rather than a job the client polls: the reader pasted one
 * link and is watching one card, and a placeholder held until the response
 * lands says the same thing a progress endpoint would.
 *
 * A URL the pipeline already fetched is *saved*, not refused. `source_url` is
 * uniquely indexed so it cannot be stored twice, but that is a storage fact,
 * not a reason the reader cannot keep something — the row is simply flagged,
 * and stays in the feed it belongs to as well. Only a URL already in the
 * library comes back as a duplicate, because then there is nothing left to do.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const url = parsePastedUrl(body.url);
  if (!url) {
    return NextResponse.json(
      { error: "That doesn't look like a link" },
      { status: 400 }
    );
  }

  if (isBlockedHost(new URL(url).hostname)) {
    return NextResponse.json(
      { error: "That link points inside your network" },
      { status: 400 }
    );
  }

  const existing = await getArticleBySourceUrl(url);
  if (existing) {
    if (existing.library) {
      return NextResponse.json({ status: "duplicate", article: existing });
    }

    // Already in the archive — keep the row, just add it to the library. No
    // second fetch and no second copy: the body was clipped when the pipeline
    // ingested it, and it is the same article.
    await addToLibrary(existing.slug);
    const saved = await getArticleBySlug(existing.slug);

    console.log(`[library] Saved from feed: ${existing.title.slice(0, LOG_TITLE_LEN)}`);
    return NextResponse.json({ status: "saved", article: saved ?? existing });
  }

  const { article, content } = await buildLibraryClip(url);
  const inserted = await insertArticle(article, content);

  if (!inserted) {
    // Lost a race with another paste of the same link, or the title collided
    // with an existing slug. Either way the article the reader wanted is now
    // in the table, so report it the same way a pre-checked duplicate is.
    const stored = await getArticleBySourceUrl(url);
    return NextResponse.json({ status: "duplicate", article: stored ?? article });
  }

  console.log(
    `[library] Clipped ${article.clipped ? "" : "(link only) "}${article.title.slice(0, LOG_TITLE_LEN)}`
  );

  return NextResponse.json({ status: "created", article });
}

/**
 * Take an article out of the library.
 *
 * What that means depends on where it came from, which is the whole point of
 * keeping origin and membership in separate columns. A pasted page exists only
 * because it was saved, so removing it deletes the row. A feed article was
 * there first and stays — unsaving must not delete Thursday's news out of the
 * archive because the reader tidied their library.
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.slug || typeof body.slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const article = await getArticleBySlug(body.slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const wasPasted = article.feed === LIBRARY_FEED;
  if (wasPasted) {
    await deleteArticle(article.slug);
  } else {
    await removeFromLibrary(article.slug);
  }

  console.log(
    `[library] ${wasPasted ? "Deleted" : "Unsaved"} ${article.title.slice(0, LOG_TITLE_LEN)}`
  );

  return NextResponse.json({ slug: article.slug, deleted: wasPasted });
}
