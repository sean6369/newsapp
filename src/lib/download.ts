import type { Article } from "@/lib/types";
import { buildArticleMarkdownHeader } from "@/lib/articles";

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadMarkdown(article: Article, content: string) {
  const header = buildArticleMarkdownHeader(article);
  downloadBlob(header + content, `${article.slug}.md`);
}

export function downloadPdf(article: Article) {
  window.open(`/api/pdf?slug=${article.slug}`, "_blank");
}
