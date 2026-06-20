"use client";

import { useEffect, useRef } from "react";
import { Button } from "@heroui/react/button";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  slug: string;
  onClose?: () => void;
}

export function ChatPanel({ slug, onClose }: ChatPanelProps) {
  const { messages, sendMessage, isStreaming, isSearching, error, clearMessages } = useChat(slug);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0 border-l border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-8 pb-3 border-b border-border">
        <h3 className="text-base font-medium text-foreground">Chat</h3>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-muted hover:text-foreground transition-colors"
              aria-label="Hide chat panel"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
                <polyline points="19 9 22 12 19 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted">Ask a question about this article.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={msg.id ?? i} message={msg} />
        ))}
        {isStreaming && messages[messages.length - 1]?.content === "" && (
          <div className="font-serif text-base italic">
            <span className="thinking-shimmer">
              {isSearching ? "Searching the web..." : "Thinking..."}
            </span>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && !isStreaming && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
{["Summarise", "Key takeaways", "Explain like I'm 5", "Critical analysis"].map((prompt) => (
            <Button
              key={prompt}
              variant="outline"
              size="sm"
              onPress={() => sendMessage(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3">
        <ChatInput onSend={sendMessage} disabled={isStreaming} />
      </div>
    </div>
  );
}
