"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ArticleReader } from "@/components/ArticleReader";
import { ChatPanel } from "@/components/ChatPanel";
import type { Article } from "@/lib/types";

interface ArticleReaderClientProps {
  article: Article;
  content: string;
}

export function ArticleReaderClient({ article, content }: ArticleReaderClientProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");

  return (
    <div className="h-dvh flex overflow-hidden relative">
      {/* Article */}
      <div className="flex-1 min-w-0">
        <ArticleReader article={article} content={content} onToggleChat={() => setChatOpen(true)} chatOpen={chatOpen} />
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {chatOpen && (
          isMobile ? (
            <motion.div
              key="chat-mobile"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="absolute inset-0 z-10 bg-background will-change-transform"
            >
              <ChatPanel slug={article.slug} onClose={() => setChatOpen(false)} />
            </motion.div>
          ) : (
            <motion.div
              key="chat-desktop"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "40%", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="h-full overflow-hidden"
            >
              <div className="h-full min-w-[300px]">
                <ChatPanel slug={article.slug} onClose={() => setChatOpen(false)} />
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
