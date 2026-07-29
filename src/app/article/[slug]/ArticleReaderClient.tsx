"use client";

import { ReaderLayout } from "@/components/ReaderLayout";
import { ArticleReader } from "@/components/ArticleReader";
import type { Article } from "@/lib/types";

interface ArticleReaderClientProps {
  article: Article;
  content: string;
}

export function ArticleReaderClient({ article, content }: ArticleReaderClientProps) {
  return (
    <ReaderLayout chatId={article.slug}>
      {({ onToggleChat, chatOpen }) => (
        <ArticleReader
          article={article}
          content={content}
          onToggleChat={onToggleChat}
          chatOpen={chatOpen}
        />
      )}
    </ReaderLayout>
  );
}
