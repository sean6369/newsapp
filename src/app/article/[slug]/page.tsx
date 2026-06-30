import { notFound } from "next/navigation";
import { getArticleBySlug, getArticleContent, getEntitiesForArticle, getTopicsForArticle } from "@/lib/db/queries";
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

  const [content, entities, topics] = await Promise.all([
    getArticleContent(slug),
    getEntitiesForArticle(slug),
    getTopicsForArticle(slug),
  ]);

  return (
    <ArticleReaderClient
      article={article}
      content={content ?? article.summary}
      entities={entities}
      topics={topics}
    />
  );
}
