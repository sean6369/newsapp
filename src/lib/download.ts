import type { Article } from "@/lib/types";

export function downloadMarkdown(article: Article, content: string) {
  const header = [
    `# ${article.title}`,
    "",
    `- **Source:** [${article.sourceDomain}](${article.sourceUrl})`,
    `- **Date:** ${article.date}`,
    `- **Feed:** ${article.feed}`,
    `- **Reading time:** ${article.readingTime} min`,
    "",
    "---",
    "",
  ].join("\n");

  const blob = new Blob([header + content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${article.slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadPdf(article: Article) {
  window.open(`/api/pdf?slug=${article.slug}`, "_blank");
}
