import { Suspense } from "react";
import { cookies } from "next/headers";
import { Feed } from "@/components/Feed";
import type { ViewMode } from "@/components/ArticleGrid";

async function FeedWithView() {
  const cookieStore = await cookies();
  const viewCookie = cookieStore.get("feed-view")?.value;
  const initialView: ViewMode = viewCookie === "list" ? "list" : "grid";

  return <Feed initialView={initialView} />;
}

export default function FeedPage() {
  return (
    <Suspense>
      <FeedWithView />
    </Suspense>
  );
}
