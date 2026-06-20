import { NextRequest, NextResponse } from "next/server";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { getArticleBySlug, getArticleContent } from "@/lib/db/queries";

const GOTENBERG_URL = process.env.GOTENBERG_URL || "http://gotenberg:3000";

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify)
    .process(markdown);
  return String(result);
}

function buildHtml(
  title: string,
  meta: string,
  bodyHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root {
  --background: #faf8f5;
  --foreground: #1a1a1a;
  --muted: #6b6b6b;
  --border: #e5e2de;
  --accent: #c96442;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--foreground);
  background: var(--background);
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  line-height: 1.6;
}

h1.article-title {
  font-family: 'Newsreader', Georgia, serif;
  font-size: 2rem;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin-bottom: 0.5rem;
}

.article-meta {
  color: var(--muted);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

hr {
  border: none;
  border-top: 1px solid var(--border);
  margin-bottom: 2rem;
}

/* Article prose styles */
article h1, article h2, article h3, article h4 {
  font-family: 'Newsreader', Georgia, serif;
  letter-spacing: -0.02em;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

article h1 { font-size: 2rem; line-height: 1.2; }
article h2 { font-size: 1.5rem; line-height: 1.3; }
article h3 { font-size: 1.25rem; line-height: 1.4; }

article p {
  line-height: 1.75;
  margin-bottom: 1em;
}

article a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

article img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 1rem 0;
}

article blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 1rem;
  color: var(--muted);
  margin: 1em 0;
  font-style: italic;
}

article pre {
  background: #f6f4f0;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.8rem;
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 1em 0;
}

article code {
  font-family: 'JetBrains Mono', monospace;
}

article :not(pre) > code {
  background: #f0eeea;
  padding: 0.15em 0.35em;
  border-radius: 0.25rem;
  font-size: 0.875em;
}

article ul, article ol {
  padding-left: 1.5em;
  margin-bottom: 1em;
}

article li {
  margin-bottom: 0.25em;
  line-height: 1.75;
}

article table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.875rem;
}

article th, article td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
}

article th {
  background: #f6f4f0;
  font-weight: 600;
}

article strong { font-weight: 600; }
</style>
</head>
<body>
<h1 class="article-title">${title}</h1>
<p class="article-meta">${meta}</p>
<hr>
<article>${bodyHtml}</article>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
  }

  const article = await getArticleBySlug(slug);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const content = (await getArticleContent(slug)) ?? article.summary;
  const bodyHtml = await markdownToHtml(content);

  const title = escapeHtml(article.title);
  const metaParts = [
    escapeHtml(article.sourceDomain),
    escapeHtml(article.date),
    ...(article.readingTime > 0 ? [`${article.readingTime} min read`] : []),
  ];
  const meta = metaParts.join(" · ");

  const html = buildHtml(title, meta, bodyHtml);

  // Build multipart form data for Gotenberg
  const formData = new FormData();
  formData.append(
    "files",
    new Blob([html], { type: "text/html" }),
    "index.html"
  );
  formData.append("marginTop", "0.6");
  formData.append("marginBottom", "0.6");
  formData.append("marginLeft", "0.6");
  formData.append("marginRight", "0.6");

  const gotenbergRes = await fetch(
    `${GOTENBERG_URL}/forms/chromium/convert/html`,
    { method: "POST", body: formData }
  );

  if (!gotenbergRes.ok) {
    const errorText = await gotenbergRes.text();
    console.error("[pdf] Gotenberg error:", gotenbergRes.status, errorText);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 502 }
    );
  }

  const pdfBuffer = await gotenbergRes.arrayBuffer();

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}.pdf"`,
    },
  });
}
