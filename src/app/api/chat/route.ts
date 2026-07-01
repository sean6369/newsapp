import { NextRequest } from "next/server";
import { getArticleBySlug, getArticleContent, getStorylineById } from "@/lib/db/queries";
import { buildSystemPrompt, buildStorylineSystemPrompt } from "@/lib/chat";
import type { SearchSource } from "@/lib/types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

export async function POST(request: NextRequest) {
  const { slug, storylineId, messages } = await request.json();

  if ((!slug && !storylineId) || !messages) {
    return new Response("Missing slug/storylineId or messages", { status: 400 });
  }

  let systemPrompt: string;

  if (storylineId) {
    const storyline = await getStorylineById(Number(storylineId));
    if (!storyline) {
      return new Response("Storyline not found", { status: 404 });
    }
    systemPrompt = buildStorylineSystemPrompt(storyline);
  } else {
    const article = await getArticleBySlug(slug);
    if (!article) {
      return new Response("Article not found", { status: 404 });
    }
    const markdown = (await getArticleContent(slug)) ?? article.summary;
    systemPrompt = buildSystemPrompt(markdown, article);
  }

  // Convert messages to Gemini format ("model" instead of "assistant")
  const contents = messages.map((m: { role: string; content: string }) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(GEMINI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ google_search: {} }],
            generationConfig: { maxOutputTokens: 16384 },
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body from Gemini");

        const decoder = new TextDecoder();
        let buffer = "";
        const sources = new Map<string, SearchSource>();

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) return;

          const data = trimmed.slice(6);
          if (!data) return;

          try {
            const parsed = JSON.parse(data);
            const candidate = parsed.candidates?.[0];
            if (!candidate) return;

            // Extract grounding sources
            const groundingChunks =
              candidate.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
              for (const chunk of groundingChunks) {
                if (chunk.web?.uri) {
                  sources.set(chunk.web.uri, {
                    title: chunk.web.title || chunk.web.uri,
                    url: chunk.web.uri,
                  });
                }
              }
            }

            // Stream text (skip thinking parts)
            const parts = candidate.content?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text && !part.thought) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: part.text })}\n\n`
                    )
                  );
                }
              }
            }
          } catch {
            // Skip malformed JSON
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
          }
        }

        // Process any remaining data in the buffer (final chunk)
        if (buffer.trim()) {
          processLine(buffer);
        }

        // Send collected sources
        if (sources.size > 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ sources: [...sources.values()] })}\n\n`
            )
          );
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] Stream error:", message);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
