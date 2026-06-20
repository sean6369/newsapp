import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType } from "@/lib/types";

interface ChatMessageProps {
  message: ChatMessageType;
}

const entrance = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <motion.div className="flex justify-end" {...entrance}>
        <div className="max-w-[85%] rounded-xl px-4 py-2.5 text-sm bg-[#EFEEEB] text-foreground">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="min-w-0 overflow-hidden" {...entrance}>
      <div className="font-serif text-base leading-relaxed text-foreground prose max-w-none prose-p:my-3 prose-headings:my-4 prose-headings:font-serif prose-headings:tracking-tight prose-ul:my-2.5 prose-li:my-1 prose-a:text-accent prose-a:break-all prose-strong:text-foreground prose-blockquote:border-accent/30 prose-blockquote:text-muted prose-code:font-mono prose-code:text-[14px]">
        {message.content && <ReactMarkdown>{message.content}</ReactMarkdown>}
      </div>
      {message.sources && message.sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted mb-1.5">Sources</p>
          <div className="flex flex-col gap-1">
            {message.sources.slice(0, 3).map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline underline-offset-2 truncate"
              >
                {source.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
