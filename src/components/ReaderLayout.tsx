"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ChatPanel } from "@/components/ChatPanel";

interface ReaderLayoutProps {
  chatId: string;
  children: (props: { onToggleChat: () => void; chatOpen: boolean }) => ReactNode;
}

export function ReaderLayout({ chatId, children }: ReaderLayoutProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");

  return (
    <div className="h-dvh flex overflow-hidden relative">
      {/* Content */}
      <div className="flex-1 min-w-0">
        {children({ onToggleChat: () => setChatOpen(true), chatOpen })}
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
              <ChatPanel slug={chatId} onClose={() => setChatOpen(false)} />
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
                <ChatPanel slug={chatId} onClose={() => setChatOpen(false)} />
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
