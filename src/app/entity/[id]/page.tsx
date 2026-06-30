import { notFound } from "next/navigation";
import { getEntityById, getArticlesForEntity, getCoOccurringEntities } from "@/lib/db/queries";
import { groupByStory } from "@/lib/group-stories";
import { EntityPage } from "@/components/EntityPage";

interface EntityPageProps {
  params: Promise<{ id: string }>;
}

export default async function EntityPageRoute({ params }: EntityPageProps) {
  const { id } = await params;
  const entityId = parseInt(id, 10);

  if (isNaN(entityId)) {
    notFound();
  }

  const entity = await getEntityById(entityId);

  if (!entity) {
    notFound();
  }

  const [rawArticles, coOccurring] = await Promise.all([
    getArticlesForEntity(entityId),
    getCoOccurringEntities(entityId, 2),
  ]);

  const articles = groupByStory(rawArticles);

  return (
    <EntityPage
      entity={entity}
      articles={articles}
      coOccurring={coOccurring}
    />
  );
}
