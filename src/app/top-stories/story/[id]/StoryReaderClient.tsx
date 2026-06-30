"use client";

import { ReaderLayout } from "@/components/ReaderLayout";
import { StoryReader } from "@/components/StoryReader";
import type { Article } from "@/lib/types";

interface StoryReaderClientProps {
  storylineId: number;
  headline: string;
  summary: string;
  fullStory: string;
  articles: Article[];
}

export function StoryReaderClient({ storylineId, headline, summary, fullStory, articles }: StoryReaderClientProps) {
  return (
    <ReaderLayout chatId={`storyline:${storylineId}`}>
      {({ onToggleChat, chatOpen }) => (
        <StoryReader
          storylineId={storylineId}
          headline={headline}
          summary={summary}
          fullStory={fullStory}
          articles={articles}
          onToggleChat={onToggleChat}
          chatOpen={chatOpen}
        />
      )}
    </ReaderLayout>
  );
}
