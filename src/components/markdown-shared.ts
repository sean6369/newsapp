import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * What react-markdown hands a component override.
 *
 * Alongside the element's own props it passes `node`, its handle on the
 * position in the syntax tree the element came from. Useful to an override
 * that wants to inspect the source; meaningless to the DOM.
 */
export type MarkdownProps<T extends ElementType> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

/**
 * The props minus `node`, ready to spread onto a real element.
 *
 * Spreading the props through untouched puts a literal
 * `node="[object Object]"` attribute on the rendered tag — which is what every
 * code block and every embed in the article reader carried until this existed.
 * Harmless to look at and invalid all the same.
 *
 * Copy-and-delete rather than destructuring: `const { node, ...rest }` leaves
 * `node` bound and unused, which is a lint error suppressed once per override
 * rather than a problem solved once. An override already dropping props that
 * way — `EmbedIframe` discards the author's width and height — is better off
 * naming `node` alongside them than filtering twice.
 */
export function withoutNode<P extends { node?: unknown }>(props: P): Omit<P, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}
