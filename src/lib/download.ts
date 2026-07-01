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

export function downloadStorylinePdf(storylineId: number) {
  window.open(`/api/pdf?storylineId=${storylineId}`, "_blank");
}

export function downloadStorylineMarkdown(
  storylineId: number,
  headline: string,
  fullStory: string,
  articles: Article[]
) {
  const sourceList = articles
    .map((a) => `- [${a.title}](${a.sourceUrl}) — ${a.sourceDomain}, ${a.date}`)
    .join("\n");

  const header = [
    `# ${headline}`,
    "",
    `- **Sources:** ${articles.length} article${articles.length !== 1 ? "s" : ""}`,
    "",
    "---",
    "",
  ].join("\n");

  const footer = [
    "",
    "",
    "---",
    "",
    "## Source Articles",
    "",
    sourceList,
    "",
  ].join("\n");

  downloadBlob(header + fullStory + footer, `storyline-${storylineId}.md`);
}
