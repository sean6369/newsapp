import { Suspense } from "react";
import { cookies } from "next/headers";
import { Feed } from "@/components/Feed";
import { FEED_VIEW_COOKIE, parseViewCookie } from "@/lib/view-cookie";

async function FeedWithView() {
  const cookieStore = await cookies();
  const initialView = parseViewCookie(cookieStore.get(FEED_VIEW_COOKIE)?.value, "grid");

  return <Feed initialView={initialView} />;
}

export default function FeedPage() {
  return (
    <Suspense>
      <FeedWithView />
    </Suspense>
  );
}
