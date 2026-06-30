"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@heroui/react/button";
import { Modal } from "@heroui/react/modal";
import type { Article } from "@/lib/types";
import { shareViaTelegram } from "@/lib/telegram";
import { downloadStorylineMarkdown, downloadStorylinePdf } from "@/lib/download";

interface StoryReaderProps {
  storylineId: number;
  headline: string;
  summary: string;
  fullStory: string;
  articles: Article[];
  onToggleChat?: () => void;
  chatOpen?: boolean;
}

export function StoryReader({ storylineId, headline, summary, fullStory, articles, onToggleChat, chatOpen }: StoryReaderProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const stagger = (i: number) => ({
    animation: `card-in 0.3s cubic-bezier(0.25, 0.1, 0.25, 1) ${i * 0.05}s both`,
  });

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4" style={stagger(0)}>
          <Link
            href="/top-stories"
            className="inline-flex items-center text-muted hover:text-foreground transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-sm">Top Stories</span>
          </Link>

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

        {/* Story metadata */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-muted mb-3" style={stagger(1)}>
            <span>Synthesized from {articles.length} source article{articles.length !== 1 ? "s" : ""}</span>
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
                        onClick={() => { setShareOpen(false); shareViaTelegram(typeof window !== "undefined" ? window.location.href : "", headline); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        Story link
                        <span className="block text-xs text-muted truncate">{typeof window !== "undefined" ? window.location.href : ""}</span>
                      </button>
                    </Modal.Body>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal.Root>
            <span>&middot;</span>
            <Modal.Root isOpen={downloadOpen} onOpenChange={setDownloadOpen}>
              <Modal.Trigger className="hover:text-foreground transition-colors cursor-pointer" aria-label="Download story">
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
                      <Modal.Heading>Download story</Modal.Heading>
                      <Modal.CloseTrigger />
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-1">
                      <button
                        onClick={() => { setDownloadOpen(false); downloadStorylineMarkdown(storylineId, headline, fullStory, articles); }}
                        className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                      >
                        Markdown
                        <span className="block text-xs text-muted">.md file with source articles</span>
                      </button>
                      <button
                        onClick={() => { setDownloadOpen(false); downloadStorylinePdf(storylineId); }}
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

          <h1 className="font-serif text-3xl font-medium leading-tight tracking-tight mb-2" style={stagger(2)}>
            {headline}
          </h1>

          <p className="text-muted text-sm leading-relaxed italic" style={stagger(3)}>
            {summary}
          </p>
        </div>

        <hr className="border-border mb-8" style={stagger(4)} />

        {/* Full story content */}
        <article className="prose md:prose-lg max-w-none prose-article prose-headings:text-foreground prose-p:text-foreground prose-a:text-accent prose-strong:text-foreground prose-code:text-foreground prose-blockquote:border-accent/30 prose-blockquote:text-muted" style={stagger(5)}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {fullStory}
          </ReactMarkdown>
        </article>

        <div className="mt-8 flex justify-start gap-2">
          <Button variant="ghost" size="sm" className="text-muted" onPress={() => setShareOpen(true)} aria-label="Share via Telegram">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            Share
          </Button>
          <Button variant="ghost" size="sm" className="text-muted" onPress={() => setDownloadOpen(true)} aria-label="Download story">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download
          </Button>
        </div>

        {/* Source articles */}
        <div className="mt-10 border-t border-border pt-6" style={stagger(6)}>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-4">
            Source articles
          </h2>
          <div className="flex flex-col gap-3">
            {articles.map((article) => (
              <Link
                key={article.slug}
                href={`/article/${article.slug}`}
                className="group flex gap-3 py-3 px-4 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors line-clamp-2">
                    {article.title}
                  </p>
                  <p className="text-xs text-muted mt-1 line-clamp-2">
                    {article.summary}
                  </p>
                  <p className="text-xs text-muted mt-1.5">
                    {article.sourceDomain} · {article.date}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
