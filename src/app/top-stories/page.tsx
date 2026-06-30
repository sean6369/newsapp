import Link from "next/link";
import { getTopStorylines } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });
}

function formatDateRange(generatedAt: Date): string {
  const start = new Date(generatedAt);
  start.setDate(start.getDate() - 3);
  const end = new Date(generatedAt);
  end.setDate(end.getDate() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-SG", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Singapore",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function TopStoriesPage() {
  const { storylines, generatedAt } = await getTopStorylines();

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 pb-24 md:pb-28">
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-medium mb-1">Top Stories</h1>
          <p className="text-sm text-muted">
            The biggest stories from the last 72 hours · Refreshes daily at 7:30 AM
          </p>
        </div>

        {generatedAt && (
          <p className="text-sm text-muted mb-4">{formatDateRange(generatedAt)}</p>
        )}

        {storylines.length === 0 ? (
          <p className="text-muted text-sm">No storylines generated yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {storylines.map((storyline, i) => (
              <Link
                key={storyline.id}
                href={`/top-stories/story/${storyline.id}`}
                className="group px-5 py-4 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <span className="text-sm text-muted font-mono mt-0.5 w-6 text-right shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-foreground group-hover:text-accent transition-colors">
                      {storyline.headline}
                    </h2>
                    <p className="text-sm text-muted mt-1">
                      {storyline.summary}
                    </p>
                    <p className="text-xs text-muted mt-2">
                      {storyline.articleCount} source article{storyline.articleCount !== 1 ? "s" : ""}
                      {storyline.recentArticleCount > 0 && (
                        <> · {storyline.recentArticleCount} new today</>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {generatedAt && (
          <p className="text-xs text-muted mt-6 text-right">
            Updated {formatDate(generatedAt)}
          </p>
        )}
      </div>
    </div>
  );
}
