"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { PromptField, PromptFieldButton } from "./PromptField";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  /** Defaults to the article panel's wording, which is where this began. */
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled,
  placeholder = "Ask about this article...",
}: ChatInputProps) {
  const [text, setText] = useState("");

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <PromptField
      multiline
      autoFocus
      value={text}
      onChange={setText}
      onSubmit={handleSubmit}
      placeholder={placeholder}
      ariaLabel={placeholder}
      disabled={disabled}
      trailing={
        <PromptFieldButton
          onPress={handleSubmit}
          label="Send message"
          disabled={disabled || !text.trim()}
          active={Boolean(text.trim())}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </PromptFieldButton>
      }
    />
  );
}
