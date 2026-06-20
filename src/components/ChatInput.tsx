"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { InputGroup } from "@heroui/react/input-group";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = 100;
    el.style.height = "0";
    const scrollHeight = el.scrollHeight;
    el.style.height = Math.min(scrollHeight, maxHeight) + "px";
    el.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
    if (scrollHeight > maxHeight) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  useEffect(() => {
    const isNarrow = window.matchMedia("(max-width: 767px)").matches;
    if (!isNarrow) textareaRef.current?.focus();
  }, []);

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    const isNarrow = window.matchMedia("(max-width: 767px)").matches;
    if (isNarrow) {
      textareaRef.current?.blur();
    } else {
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <InputGroup fullWidth className={disabled ? "opacity-50" : ""}>
      <InputGroup.TextArea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about this article..."
        rows={1}
        className="resize-none overflow-hidden scrollbar-none"
      />
      <InputGroup.Suffix className="self-end mb-2">
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className={`shrink-0 p-1 rounded-md transition-colors ${
            text.trim()
              ? "bg-accent text-white"
              : "text-muted disabled:opacity-30"
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </InputGroup.Suffix>
    </InputGroup>
  );
}
