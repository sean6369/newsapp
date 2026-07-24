export const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
export const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";

export function geminiUrl(
  endpoint: "generateContent" | "streamGenerateContent",
  model: string = GEMINI_MODEL
): string {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  if (endpoint === "streamGenerateContent") {
    return `${base}:streamGenerateContent?alt=sse`;
  }
  return `${base}:generateContent`;
}
