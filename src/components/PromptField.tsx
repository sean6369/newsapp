"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { InputGroup } from "@heroui/react/input-group";

/**
 * The one text field behind both Search and Ask.
 *
 * HeroUI already dresses `SearchField` and `InputGroup` from the same field
 * tokens — same radius, border, background, text size, 36px at rest — so the
 * two pages looked close without being the same thing. Sharing the primitive
 * is what keeps them identical as either is tuned: everything either page can
 * change about the shell, it changes here, for both.
 *
 * What legitimately differs is passed in. Search leads with a magnifier and
 * trails a clear button; Ask leads with nothing and trails a send button, and
 * grows to a few lines as you type.
 */

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Leading adornment. Search passes a magnifier; Ask passes nothing. */
  icon?: React.ReactNode;
  /** Trailing control — clear on Search, send on Ask. */
  trailing?: React.ReactNode;
  /** Grows with content, and submits on Enter. */
  multiline?: boolean;
  onSubmit?: () => void;
  /**
   * Escape handler for single-line use. `SearchField`, which this replaced on
   * the search page, cleared itself on Escape via react-aria; a plain input
   * does not, so the behaviour is passed back in rather than quietly lost.
   */
  onEscape?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** A multiline field grows to roughly four lines, then scrolls. */
const MAX_TEXTAREA_HEIGHT = 100;

const isNarrowViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

export function PromptField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  icon,
  trailing,
  multiline = false,
  onSubmit,
  onEscape,
  disabled = false,
  autoFocus = false,
  className = "",
}: PromptFieldProps) {
  // Owned here rather than handed in by the caller. The auto-grow below is the
  // only thing giving a single-row textarea its correct height, and routing a
  // ref through two components and a third-party primitive to reach the node
  // is a silent failure waiting to happen — nothing errors, the box just keeps
  // its default height and the text sits wrong.
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Measured from zero each time so the field shrinks back as text is deleted
  // rather than only ever growing.
  //
  // `minHeight` and `resize` are cleared here rather than by className because
  // HeroUI sets them via `.input-group__input[data-slot="input-group-textarea"]`,
  // which outranks a utility. They matter: the 38px minimum exceeds a single
  // line's 36px content box, leaving slack under the text that reads as the
  // placeholder sitting high, and `resize: vertical` leaves a drag handle on
  // what should be an auto-sizing composer.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !multiline) return;
    el.style.minHeight = "0";
    el.style.resize = "none";
    el.style.height = "0";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [value, multiline]);

  useEffect(() => {
    if (multiline && autoFocus && !isNarrowViewport()) textareaRef.current?.focus();
  }, [multiline, autoFocus]);

  function submit() {
    onSubmit?.();
    // On a phone, a keyboard covering the reply is worse than losing focus.
    if (isNarrowViewport()) textareaRef.current?.blur();
    else textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Enter sends, shift+Enter breaks the line — only where there are lines to
    // break.
    if (multiline && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (!multiline && e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    }
  }

  return (
    <InputGroup
      fullWidth
      className={`${disabled ? "opacity-50" : ""} ${className}`.trim()}
      // HeroUI flips the group to `align-items: flex-start` whenever it holds a
      // textarea — sensible once one is several lines tall, but at rest it pins
      // a short box to the top of a 36px group, which is why Ask's placeholder
      // sat high while Search's sat centred. Recentring is safe in both states:
      // the group's height is driven by the textarea, so once it grows past the
      // minimum, centre and start coincide.
      //
      // Inline rather than a utility class because HeroUI sets this through
      // `:has([data-slot="input-group-textarea"])`, which outranks one.
      style={multiline ? { alignItems: "center" } : undefined}
    >
      {icon && <InputGroup.Prefix>{icon}</InputGroup.Prefix>}

      {multiline ? (
        <InputGroup.TextArea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={1}
          className="resize-none overflow-hidden scrollbar-none"
        />
      ) : (
        <InputGroup.Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          className="w-full"
        />
      )}

      {/* Two different alignments, and both had to be corrected.
          `self-center` centres the suffix box within the group; the inline
          style centres the button *inside* that box, because HeroUI top-aligns
          it and adds 8px of padding-top whenever a textarea is present:

            .input-group:has([data-slot="input-group-textarea"]) &
              { @apply items-start; padding-top: 0.5rem; }

          That selector outranks a utility class, so the override has to be
          inline — centring only the outer box left the arrow sitting low. */}
      {trailing && (
        <InputGroup.Suffix
          className={multiline ? "self-center" : undefined}
          style={multiline ? { alignItems: "center", paddingTop: 0 } : undefined}
        >
          {trailing}
        </InputGroup.Suffix>
      )}
    </InputGroup>
  );
}

/**
 * The trailing control, shared so clear and send occupy the same footprint.
 * `active` fills it in — Ask uses that to show the message is ready to go.
 */
export function PromptFieldButton({
  onPress,
  label,
  disabled = false,
  active = false,
  children,
}: {
  onPress: () => void;
  label: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className={`shrink-0 rounded-md p-1 transition-colors ${
        active ? "bg-accent text-white" : "text-muted hover:text-foreground disabled:opacity-30"
      }`}
    >
      {children}
    </button>
  );
}
