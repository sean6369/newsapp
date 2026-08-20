"use client";

import { usePathname } from "next/navigation";
import { FloatingDock } from "@/components/FloatingDock";
import { Home, Library, Search, Sparkles } from "lucide-react";

const navItems = [
  {
    title: "Feed",
    icon: <Home className="h-full w-full text-foreground" />,
    href: "/",
  },
  {
    title: "Library",
    icon: <Library className="h-full w-full text-foreground" />,
    href: "/library",
  },
  {
    title: "Search",
    icon: <Search className="h-full w-full text-foreground" />,
    href: "/search",
  },
  {
    title: "Ask",
    icon: <Sparkles className="h-full w-full text-foreground" />,
    href: "/ask",
  },
];

export function NavDock() {
  const pathname = usePathname();

  if (pathname.startsWith("/article/")) return null;

  return (
    <FloatingDock
      items={navItems}
      desktopClassName="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      mobileClassName="fixed bottom-8 right-5 z-50"
    />
  );
}
