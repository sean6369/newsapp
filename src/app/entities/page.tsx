import { getAllEntities, getTrendingEntities } from "@/lib/db/queries";
import { EntitiesListing } from "@/components/EntitiesListing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Entities - Leedon News",
};

export default async function EntitiesPage() {
  const [{ entities, total }, trendingList] = await Promise.all([
    getAllEntities({ sort: "trending", limit: 200 }),
    getTrendingEntities(48, 20),
  ]);

  const trending = new Map(
    trendingList.map((e, i) => [
      e.id,
      { rank: i + 1, previousRank: e.previousRank },
    ])
  );

  return <EntitiesListing entities={entities} total={total} trending={trending} />;
}
