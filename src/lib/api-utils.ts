import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug } from "./db/queries";
import type { Article } from "./types";

/** Max title length for console.log truncation across API routes */
export const LOG_TITLE_LEN = 60;

type SlugResult =
  | { article: Article; slug: string }
  | { error: NextResponse };

/**
 * Parse and validate a slug from a POST request body.
 * Returns the article and slug on success, or an error response on failure.
 */
export async function parseSlugRequest(request: NextRequest): Promise<SlugResult> {
  const body = await request.json().catch(() => null);

  if (!body?.slug || typeof body.slug !== "string") {
    return { error: NextResponse.json({ error: "slug is required" }, { status: 400 }) };
  }

  const { slug } = body;
  const article = await getArticleBySlug(slug);

  if (!article) {
    return { error: NextResponse.json({ error: "Article not found" }, { status: 404 }) };
  }

  return { article, slug };
}
