import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LibraryPage } from "@/components/LibraryPage";
import { LIBRARY_VIEW_COOKIE, parseViewCookie } from "@/lib/view-cookie";

export const metadata: Metadata = {
  title: "Library — Leedon News",
  description: "Articles you clipped yourself.",
};

export default async function Library() {
  // Read on the server so the first paint is already in the reader's layout,
  // rather than rendering a grid and snapping to list once the client mounts.
  const cookieStore = await cookies();
  const initialView = parseViewCookie(cookieStore.get(LIBRARY_VIEW_COOKIE)?.value, "grid");

  return <LibraryPage initialView={initialView} />;
}
