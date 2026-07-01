export const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
export const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";

const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

export function geminiUrl(endpoint: "generateContent" | "streamGenerateContent"): string {
  if (endpoint === "streamGenerateContent") {
    return `${GEMINI_BASE}:streamGenerateContent?alt=sse`;
  }
  return `${GEMINI_BASE}:generateContent`;
}
