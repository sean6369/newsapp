import { USER_INTERESTS } from "./interests";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function scoreArticle(article: {
  title: string;
  summary: string;
  category: string;
  feed: string;
}): Promise<number | null> {
  try {
    const prompt = `You are a news relevance scorer. Rate this article on 4 dimensions with the given ranges.
Do NOT round scores to multiples of 5 — use precise values like 17, 23, 6.
Use the full range of each dimension: give low scores to weak matches and high scores to strong ones.

DIMENSIONS:
- Relevance (0-40): How closely does this match the user's stated interests? (0 = completely unrelated, 40 = core interest)
- Impact (0-25): How significant or consequential is this news? (0 = trivial, 25 = major/breaking)
- Uniqueness (0-10): How novel or surprising is this? (0 = routine/expected, 10 = unprecedented)
- Actionability (0-25): How useful is it for the user to know this right now? (0 = no urgency, 25 = must-know)

USER INTERESTS:
${USER_INTERESTS}

ARTICLE:
Title: ${article.title}
Summary: ${article.summary}
Category: ${article.category}
Feed: ${article.feed}

Respond with ONLY four integers separated by commas (e.g. "28,17,6,22"). No other text.`;

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 256 },
        },
      }),
    });

    if (!response.ok) {
      console.error(`[scorer] Gemini API error ${response.status}`);
      return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;

    // gemini-2.5-flash is a thinking model — parts[0] is the thought,
    // the actual answer is the last non-thought part.
    const text = parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.pop()?.text?.trim();

    if (!text) {
      console.error("[scorer] No text in Gemini response");
      return null;
    }

    // Parse four comma-separated integers
    const nums = text.match(/(\d+)/g)?.map(Number);
    const maxPerDim = [40, 25, 10, 25];
    if (
      !nums ||
      nums.length !== 4 ||
      nums.some((n: number, i: number) => n < 0 || n > maxPerDim[i])
    ) {
      console.error(`[scorer] Invalid response: "${text}"`);
      return null;
    }

    const total = nums[0] + nums[1] + nums[2] + nums[3];
    // Convert 0-100 to 0.0-10.0 with 1 d.p.
    return Math.round(total) / 10;
  } catch (error) {
    console.error("[scorer] Error scoring article:", error);
    return null;
  }
}
