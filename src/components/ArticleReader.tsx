"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Modal } from "@heroui/react/modal";
import type { Article, ArticleEntity, Topic } from "@/lib/types";
import { shareViaTelegram } from "@/lib/telegram";
import { downloadMarkdown, downloadPdf } from "@/lib/download";

function CodeBlock(props: ComponentPropsWithoutRef<"pre">) {
  const codeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = codeRef.current?.querySelector("code")?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div ref={codeRef} className="relative group">
      <pre {...props} />
      <button
        onClick={handleCopy}
        className="absolute top-[1.5rem] right-[1.5rem] p-2 rounded-md bg-white/80 border border-border text-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Copy code"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}

const ALLOWED_EMBED_HOSTS = ["flo.uri.sh", "datawrapper.dwcdn.net"];

function EmbedIframe({ width: _w, height: _h, style: _s, ...props }: ComponentPropsWithoutRef<"iframe">) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const src = props.src || "";

  let host: string;
  try {
    host = new URL(src).hostname;
    if (!ALLOWED_EMBED_HOSTS.includes(host)) return null;
  } catch {
    return null;
  }

  // Listen for postMessage resize events from Datawrapper and Flourish
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;

      // Datawrapper: { "datawrapper-height": { "chartId": 400 } }
      if (typeof e.data === "object" && e.data["datawrapper-height"]) {
        const heights = e.data["datawrapper-height"] as Record<string, number>;
        const h = Object.values(heights)[0];
        if (h) setHeight(h);
        return;
      }

      // Flourish: { method: "resize", value: { height: 400 } }
      // Also try: { type: "resize", height: 400 }
      if (typeof e.data === "object") {
        if (e.data.method === "resize" && e.data.value?.height) {
          setHeight(e.data.value.height);
        } else if (e.data.type === "resize" && e.data.height) {
          setHeight(e.data.height);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      {...props}
      className="w-full rounded-lg border border-border my-4"
      style={height ? { height: `${height}px` } : { aspectRatio: "4 / 3" }}
      loading="lazy"
    />
  );
}

interface ArticleReaderProps {
  article: Article;
  content: string;
  entities: ArticleEntity[];
  topics: Topic[];
  onToggleChat?: () => void;
  chatOpen?: boolean;
}

export function ArticleReader({ article, content, entities, topics, onToggleChat, chatOpen }: ArticleReaderProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const stagger = (i: number) => ({
    animation: `card-in 0.3s cubic-bezier(0.25, 0.1, 0.25, 1) ${i * 0.05}s both`,
  });

  return (
    <div className="overflow-y-auto h-full">
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4" style={stagger(0)}>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center text-muted hover:text-foreground transition-colors"
          aria-label="Back to feed"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm">Back</span>
        </button>

        {onToggleChat && !chatOpen && (
          <button
            onClick={onToggleChat}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Open chat panel"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
              <polyline points="10 15 7 12 10 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Article metadata */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 text-sm text-muted mb-3" style={stagger(1)}>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://www.google.com/s2/favicons?domain=${article.sourceDomain}&sz=16`} alt="" width={14} height={14} className="rounded-sm" />
            <a
              href={article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors underline underline-offset-2"
            >
              {article.sourceDomain}
            </a>
            <span className="hidden md:inline">&middot;</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{article.date}</span>
            {article.readingTime > 0 && (
              <>
                <span>&middot;</span>
                <span>{article.readingTime} min read</span>
              </>
            )}
            <span>&middot;</span>
            <span className="uppercase tracking-wider text-xs font-medium">
              {article.feed}
            </span>
            <span>&middot;</span>
            <Modal.Root isOpen={shareOpen} onOpenChange={setShareOpen}>
              <Modal.Trigger className="hover:text-foreground transition-colors cursor-pointer" aria-label="Share via Telegram">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
              </Modal.Trigger>
              <Modal.Backdrop className="bg-linear-to-t from-black/80 via-black/40 to-transparent dark:from-zinc-800/80 dark:via-zinc-800/40" variant="blur">
                <Modal.Container size="sm" placement="top">
                  <Modal.Dialog>
                    <Modal.Header>
                      <Modal.Heading>Share via Telegram</Modal.Heading>
                      <Modal.CloseTrigger />
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-1">
                      <button
                        onClick={() => { setShareOpen(false); shareViaTelegram(article.sourceUrl, article.title); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        Original link
                        <span className="block text-xs text-muted truncate">{article.sourceDomain}</span>
                      </button>
                      <button
                        onClick={() => { setShareOpen(false); shareViaTelegram(window.location.href, article.title); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        Article link
                        <span className="block text-xs text-muted truncate">{typeof window !== "undefined" ? window.location.href : ""}</span>
                      </button>
                    </Modal.Body>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal.Root>
            <span>&middot;</span>
            <Modal.Root isOpen={downloadOpen} onOpenChange={setDownloadOpen}>
              <Modal.Trigger className="hover:text-foreground transition-colors cursor-pointer" aria-label="Download article">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </Modal.Trigger>
              <Modal.Backdrop className="bg-linear-to-t from-black/80 via-black/40 to-transparent dark:from-zinc-800/80 dark:via-zinc-800/40" variant="blur">
                <Modal.Container size="sm" placement="top">
                  <Modal.Dialog>
                    <Modal.Header>
                      <Modal.Heading>Download article</Modal.Heading>
                      <Modal.CloseTrigger />
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-1">
                      <button
                        onClick={() => { setDownloadOpen(false); downloadMarkdown(article, content); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        Markdown
                        <span className="block text-xs text-muted">.md file with metadata header</span>
                      </button>
                      <button
                        onClick={() => { setDownloadOpen(false); downloadPdf(article); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        PDF
                        <span className="block text-xs text-muted">Save as PDF</span>
                      </button>
                    </Modal.Body>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal.Root>
          </div>
        </div>

        <h1 className="font-serif text-3xl font-medium leading-tight tracking-tight mb-2" style={stagger(2)}>
          {article.title}
        </h1>

        <p className="text-muted text-sm leading-relaxed italic" style={stagger(3)}>
          {article.summary}
        </p>
      </div>

      <hr className="border-border mb-8" style={stagger(4)} />

      {!article.clipped && (
        <Alert status="warning" className="mb-6" style={stagger(5)}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>This article could not be fully clipped.</Alert.Title>
          </Alert.Content>
        </Alert>
      )}

      {/* Article content */}
      <article className="prose md:prose-lg max-w-none prose-article prose-headings:text-foreground prose-p:text-foreground prose-a:text-accent prose-strong:text-foreground prose-code:text-foreground prose-blockquote:border-accent/30 prose-blockquote:text-muted" style={stagger(5)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true, subset: ["python", "javascript", "typescript", "bash", "json", "css", "html", "sql", "rust", "go", "c", "cpp"] }]]} components={{ pre: CodeBlock, iframe: EmbedIframe }}>
          {content}
        </ReactMarkdown>
      </article>

      <div className="mt-8 flex justify-start gap-2">
        <Button variant="ghost" size="sm" className="text-muted" onPress={() => setShareOpen(true)} aria-label="Share via Telegram">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          Share
        </Button>
        <Button variant="ghost" size="sm" className="text-muted" onPress={() => setDownloadOpen(true)} aria-label="Download article">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </Button>
      </div>

      {/* Entities & Topics */}
      {(entities.length > 0 || topics.length > 0) && (
        <div className="mt-10 border-t border-border pt-6" style={stagger(6)}>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-4">Entities & Topics</h2>

          {topics.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {topics.map((t) => (
                <span key={t.id} className="px-2.5 py-1 text-xs rounded-full bg-accent/10 text-accent font-medium">
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {entities.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="pb-2 font-medium">Entity</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium text-right">Salience</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="py-2">
                      <Link href={`/entity/${e.id}`} className="text-foreground hover:text-accent hover:underline transition-colors">
                        {e.name}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span className="text-xs text-muted capitalize">{e.type}</span>
                    </td>
                    <td className="py-2 text-right">
                      {e.salience != null && (
                        <span className="text-xs text-muted tabular-nums">{e.salience.toFixed(2)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
