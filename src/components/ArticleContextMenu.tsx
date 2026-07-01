"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Modal } from "@heroui/react/modal";
import { shareViaTelegram } from "@/lib/telegram";

interface ArticleContextMenuProps {
  slug: string;
  sourceUrl: string;
  sourceDomain: string;
  title: string;
  children: (menuTrigger: React.ReactNode, setActiveSlug: (slug: string) => void) => React.ReactNode;
  onRescore?: (slug: string) => void;
  onDelete?: (slug: string) => void;
}

export function ArticleContextMenu({ slug, sourceUrl, sourceDomain, title, children, onRescore, onDelete }: ArticleContextMenuProps) {
  const slugRef = useRef(slug);
  const sourceUrlRef = useRef(sourceUrl);
  const sourceDomainRef = useRef(sourceDomain);
  const titleRef = useRef(title);
  const setActiveSlug = useCallback((s: string) => { slugRef.current = s; }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; origin: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [modalInfo, setModalInfo] = useState({ slug, sourceUrl, sourceDomain, title });
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Keep refs in sync when article changes (e.g. story group cycling)
  useEffect(() => {
    sourceUrlRef.current = sourceUrl;
    sourceDomainRef.current = sourceDomain;
    titleRef.current = title;
  }, [sourceUrl, sourceDomain, title]);

  const openMenu = useCallback((x: number, y: number, origin = "top left") => {
    setMenu({
      x: Math.min(x, window.innerWidth - 180),
      y: Math.min(y, window.innerHeight - 60),
      origin,
    });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  }, [openMenu]);

  const handleTriggerClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu) {
      close();
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(Math.max(0, rect.right - 160), rect.bottom + 4, "top right");
    }
  }, [menu, openMenu, close]);

  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  const handleRescore = () => {
    onRescore?.(slugRef.current);
    close();
  };

  const handleDelete = () => {
    onDelete?.(slugRef.current);
    close();
  };

  const handleShare = () => {
    close();
    setModalInfo({ slug: slugRef.current, sourceUrl: sourceUrlRef.current, sourceDomain: sourceDomainRef.current, title: titleRef.current });
    setShareOpen(true);
  };

  const handleDownload = () => {
    close();
    setModalInfo({ slug: slugRef.current, sourceUrl: sourceUrlRef.current, sourceDomain: sourceDomainRef.current, title: titleRef.current });
    setDownloadOpen(true);
  };

  const menuTrigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={handleTriggerClick}
      className="md:hidden p-1 rounded-md text-muted hover:text-foreground hover:bg-accent/10 transition-colors cursor-pointer"
      aria-label="Article actions"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="13" cy="8" r="1.5" />
      </svg>
    </button>
  );

  return (
    <div className="relative" onContextMenu={handleContextMenu}>
      {/* eslint-disable-next-line react-hooks/refs -- setActiveSlug is a callback passed as a prop, not a ref read */}
      {children(menuTrigger, setActiveSlug)}
      {createPortal(
        <AnimatePresence>
          {menu && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, scale: 0.6, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7, y: -4 }}
              transition={{ type: "spring", duration: 0.35, bounce: 0.3 }}
              className="fixed z-50 w-[160px] bg-background border-2 border-border rounded-lg shadow-lg py-1"
              style={{ left: menu.x, top: menu.y, transformOrigin: menu.origin }}
            >
              <button
                type="button"
                onClick={handleShare}
                className="w-full text-left px-4 py-2 text-sm hover:bg-accent/10 transition-colors cursor-pointer"
              >
                Share
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="w-full text-left px-4 py-2 text-sm hover:bg-accent/10 transition-colors cursor-pointer"
              >
                Download
              </button>
              <button
                type="button"
                onClick={handleRescore}
                className="w-full text-left px-4 py-2 text-sm hover:bg-accent/10 transition-colors cursor-pointer"
              >
                Rescore
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {shareOpen && (
        <Modal.Root isOpen onOpenChange={setShareOpen}>
          <Modal.Trigger className="sr-only"><span>Share</span></Modal.Trigger>
          <Modal.Backdrop className="bg-linear-to-t from-black/80 via-black/40 to-transparent dark:from-zinc-800/80 dark:via-zinc-800/40" variant="blur">
            <Modal.Container size="sm" placement="top">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Share via Telegram</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-1">
                  <button
                    onClick={() => { setShareOpen(false); shareViaTelegram(modalInfo.sourceUrl, modalInfo.title); }}
                    className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                  >
                    Original link
                    <span className="block text-xs text-muted truncate">{modalInfo.sourceDomain}</span>
                  </button>
                  <button
                    onClick={() => { setShareOpen(false); shareViaTelegram(`${window.location.origin}/article/${modalInfo.slug}`, modalInfo.title); }}
                    className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                  >
                    Article link
                    <span className="block text-xs text-muted truncate">{typeof window !== "undefined" ? `${window.location.origin}/article/${modalInfo.slug}` : ""}</span>
                  </button>
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal.Root>
      )}

      {downloadOpen && (
        <Modal.Root isOpen onOpenChange={setDownloadOpen}>
          <Modal.Trigger className="sr-only"><span>Download</span></Modal.Trigger>
          <Modal.Backdrop className="bg-linear-to-t from-black/80 via-black/40 to-transparent dark:from-zinc-800/80 dark:via-zinc-800/40" variant="blur">
            <Modal.Container size="sm" placement="top">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Download</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-1">
                  <button
                    onClick={() => { setDownloadOpen(false); window.open(`/api/markdown?slug=${modalInfo.slug}`, "_blank"); }}
                    className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                  >
                    Markdown
                    <span className="block text-xs text-muted">.md file with metadata header</span>
                  </button>
                  <button
                    onClick={() => { setDownloadOpen(false); window.open(`/api/pdf?slug=${modalInfo.slug}`, "_blank"); }}
                    className="text-left text-sm px-3 py-2 rounded-md hover:bg-border/50 transition-colors text-foreground"
                  >
                    PDF
                    <span className="block text-xs text-muted">Opens in browser PDF viewer</span>
                  </button>
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal.Root>
      )}
    </div>
  );
}
