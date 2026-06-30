import { notFound } from "next/navigation";
import { getStorylineById } from "@/lib/db/queries";
import { StoryReaderClient } from "./StoryReaderClient";

interface StoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { id } = await params;
  const storylineId = parseInt(id, 10);

  if (isNaN(storylineId)) {
    notFound();
  }

  const storyline = await getStorylineById(storylineId);

  if (!storyline) {
    notFound();
  }

  return (
    <StoryReaderClient
      storylineId={storyline.id}
      headline={storyline.headline}
      summary={storyline.summary}
      fullStory={storyline.fullStory}
      articles={storyline.articles}
    />
  );
}
