"use client";

import { ReaderLayout } from "@/components/ReaderLayout";
import { ArticleReader } from "@/components/ArticleReader";
import type { Article, ArticleEntity, Topic } from "@/lib/types";

interface ArticleReaderClientProps {
  article: Article;
  content: string;
  entities: ArticleEntity[];
  topics: Topic[];
}

export function ArticleReaderClient({ article, content, entities, topics }: ArticleReaderClientProps) {
  return (
    <ReaderLayout chatId={article.slug}>
      {({ onToggleChat, chatOpen }) => (
        <ArticleReader
          article={article}
          content={content}
          entities={entities}
          topics={topics}
          onToggleChat={onToggleChat}
          chatOpen={chatOpen}
        />
      )}
    </ReaderLayout>
  );
}
