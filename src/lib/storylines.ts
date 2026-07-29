import {
  getRecentArticles,
  deleteStorylinesByBatch,
  insertStoryline,
} from "./db/queries";
import { OPENAI_API_KEY, OPENAI_URL } from "./openai";

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseOpenAIText(data: any): string | null {
  return (
    data.output
      ?.filter((block: { type: string }) => block.type === "message")
      ?.flatMap((block: { content: Array<{ type: string; text: string }> }) => block.content)
      ?.find((part: { type: string }) => part.type === "output_text")?.text ?? null
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function callOpenAI(
  body: Record<string, unknown>,
  label: string
): Promise<string | null> {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`[${label}] OpenAI API error ${response.status}: ${await response.text()}`);
    return null;
  }

  const data = await response.json();
  return parseOpenAIText(data);
}

interface StorylineCluster {
  headline: string;
  summary: string;
  articleIndices: number[];
}

/** Pass 1: Cluster articles into storylines using titles + summaries */
async function clusterStorylines(
  articles: Array<{ title: string; summary: string }>
): Promise<StorylineCluster[] | null> {
  if (articles.length === 0) return [];

  const articleList = articles
    .map((a, i) => `${i + 1}. ${a.title}\n   ${a.summary}`)
    .join("\n\n");

  const prompt = `You are given ${articles.length} recent news articles from various sources. Identify the biggest stories of the moment by grouping related articles into storylines.

For each storyline, provide:
- headline: A short descriptive headline for the storyline (not copied from any article)
- summary: 1-2 sentences explaining what this storyline is about
- articleIndices: The 1-based indices of the articles that belong to this storyline

Prioritize major, consequential stories — geopolitical developments, policy changes, significant events, major business moves, and technological breakthroughs. Ignore minor, local, or trivial news. Each storyline must have at least 2 articles. Return the top 10-15 most significant storylines, ranked by global importance. Not every article needs to be assigned — drop articles that are minor or don't fit a clear storyline.

ARTICLES:
${articleList}`;

  try {
    const text = await callOpenAI(
      {
        model: "gpt-5.4-mini",
        reasoning: { effort: "low" },
        input: [{ role: "user", content: prompt }],
        text: {
          format: {
            type: "json_schema",
            name: "storylines",
            strict: true,
            schema: {
              type: "object",
              properties: {
                storylines: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      headline: { type: "string" },
                      summary: { type: "string" },
                      articleIndices: {
                        type: "array",
                        items: { type: "integer" },
                      },
                    },
                    required: ["headline", "summary", "articleIndices"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["storylines"],
              additionalProperties: false,
            },
          },
        },
      },
      "storylines"
    );

    if (!text) return null;

    const parsed = JSON.parse(text) as { storylines: StorylineCluster[] };

    // Convert 1-based indices to 0-based and filter out invalid indices
    return parsed.storylines.map((s) => ({
      ...s,
      articleIndices: s.articleIndices
        .map((i) => i - 1)
        .filter((i) => i >= 0 && i < articles.length),
    }));
  } catch (error) {
    console.error("[storylines] Error clustering:", error);
    return null;
  }
}

/** Pass 2: Generate a full story from article content for a single cluster */
async function generateFullStory(
  headline: string,
  articles: Array<{ title: string; content: string | null; summary: string }>
): Promise<string | null> {
  const articleText = articles
    .map((a, i) => {
      const body = a.content || a.summary;
      return `--- Article ${i + 1}: ${a.title} ---\n${body}`;
    })
    .join("\n\n");

  const prompt = `You are a news editor. Write a comprehensive story about "${headline}", synthesizing the articles below into a single cohesive narrative.

Write in a neutral, journalistic tone. Include specific details, quotes, figures, and dates from the source articles. The story should be 3-6 paragraphs — long enough to be informative, short enough to read quickly.

Do NOT mention "according to articles" or reference the source articles directly. Write as if this is an original news report.

SOURCE ARTICLES:
${articleText}`;

  try {
    const text = await callOpenAI(
      {
        model: "gpt-5.4-mini",
        input: [{ role: "user", content: prompt }],
      },
      "storylines"
    );

    return text || null;
  } catch (error) {
    console.error("[storylines] Error generating full story:", error);
    return null;
  }
}

/** Orchestrator: generate top storylines across the whole feed and store in DB */
export async function generateAndStoreStorylines(): Promise<{
  articles: number;
  storylines: number;
}> {
  console.log("[storylines] Starting storyline generation...");

  const allArticles = await getRecentArticles();
  if (allArticles.length < 2) {
    console.log("[storylines] Not enough recent articles");
    return { articles: 0, storylines: 0 };
  }

  console.log(`[storylines] Clustering ${allArticles.length} articles...`);

  // Pass 1: Cluster all articles into storylines
  const clusters = await clusterStorylines(allArticles);
  if (!clusters || clusters.length === 0) {
    console.log("[storylines] No clusters found");
    return { articles: allArticles.length, storylines: 0 };
  }

  console.log(`[storylines] Found ${clusters.length} clusters, generating full stories...`);

  // Pass 2: Generate full stories for each cluster in parallel
  const allStorylines: Array<{
    headline: string;
    summary: string;
    fullStory: string;
    articleSlugs: string[];
  }> = [];

  const pass2Tasks = clusters.map(async (cluster) => {
    const clusterArticles = cluster.articleIndices
      .map((i) => allArticles[i])
      .filter(Boolean);
    if (clusterArticles.length < 2) return;
    const slugs = clusterArticles.map((a) => a.slug);

    const fullStory = await generateFullStory(
      cluster.headline,
      clusterArticles.map((a) => ({
        title: a.title,
        content: a.content,
        summary: a.summary,
      }))
    );

    if (fullStory) {
      allStorylines.push({
        headline: cluster.headline,
        summary: cluster.summary,
        fullStory,
        articleSlugs: slugs,
      });
    }
  });

  await Promise.all(pass2Tasks);

  // Today's batch date in SGT
  const batchDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  // Delete any existing storylines for today's batch (re-run safety)
  await deleteStorylinesByBatch(batchDate);

  for (const s of allStorylines) {
    await insertStoryline(s.headline, s.summary, s.fullStory, s.articleSlugs, batchDate);
  }

  console.log(
    `[storylines] Generated ${allStorylines.length} storylines from ${allArticles.length} articles`
  );

  return { articles: allArticles.length, storylines: allStorylines.length };
}
