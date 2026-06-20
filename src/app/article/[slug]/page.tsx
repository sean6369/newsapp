import { notFound } from "next/navigation";
import { getArticleBySlug, getArticleContent } from "@/lib/db/queries";
import { ArticleReaderClient } from "./ArticleReaderClient";

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  const content = (await getArticleContent(slug)) ?? article.summary;

  return (
    <ArticleReaderClient
      article={article}
      content={content}
    />
  );
}
