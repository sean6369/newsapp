import { cookies } from "next/headers";
import { searchArticles, getArticleDates } from "@/lib/db/queries";
import { SearchPage } from "@/components/SearchPage";
import { SEARCH_PAGE_SIZE, DEFAULT_SEARCH_SORT } from "@/lib/types";
import { SEARCH_VIEW_COOKIE, parseViewCookie } from "@/lib/view-cookie";

export const metadata = {
  title: "Search - Leedon News",
};

export default async function SearchRoute({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q) ?? "";

  const [initial, dates, cookieStore] = await Promise.all([
    searchArticles({ query, limit: SEARCH_PAGE_SIZE, sort: DEFAULT_SEARCH_SORT }),
    getArticleDates(),
    cookies(),
  ]);

  return (
    <SearchPage
      initialQuery={query}
      initialView={parseViewCookie(cookieStore.get(SEARCH_VIEW_COOKIE)?.value, "list")}
      initialResults={initial.results}
      initialTotal={initial.total}
      initialRowCount={initial.rowCount}
      initialMode={initial.mode}
      availableDates={dates}
    />
  );
}
