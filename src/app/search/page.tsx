import { searchArticles, getArticleDates } from "@/lib/db/queries";
import { SearchPage } from "@/components/SearchPage";
import { SEARCH_PAGE_SIZE, DEFAULT_SEARCH_SORT } from "@/lib/types";

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

  const [initial, dates] = await Promise.all([
    searchArticles({ query, limit: SEARCH_PAGE_SIZE, sort: DEFAULT_SEARCH_SORT }),
    getArticleDates(),
  ]);

  return (
    <SearchPage
      initialQuery={query}
      initialResults={initial.results}
      initialTotal={initial.total}
      initialRowCount={initial.rowCount}
      initialMode={initial.mode}
      availableDates={dates}
    />
  );
}
