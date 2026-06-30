"use client";

import { usePathname } from "next/navigation";
import { FloatingDock } from "@/components/FloatingDock";
import { Home, TrendingUp, Users } from "lucide-react";

const navItems = [
  {
    title: "Feed",
    icon: <Home className="h-full w-full text-foreground" />,
    href: "/",
  },
  {
    title: "Top Stories",
    icon: <TrendingUp className="h-full w-full text-foreground" />,
    href: "/top-stories",
  },
  {
    title: "Entities",
    icon: <Users className="h-full w-full text-foreground" />,
    href: "/entities",
  },
];

export function NavDock() {
  const pathname = usePathname();

  if (pathname.startsWith("/article/") || pathname.startsWith("/top-stories/story/")) return null;

  return (
    <FloatingDock
      items={navItems}
      desktopClassName="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      mobileClassName="fixed bottom-8 right-5 z-50"
    />
  );
}
