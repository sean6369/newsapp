import { NextRequest, NextResponse } from "next/server";
import { getArticleBySlug, getArticleContent, getStorylineById } from "@/lib/db/queries";
import { buildSystemPrompt, buildStorylineSystemPrompt } from "@/lib/chat";
import { OPENAI_API_KEY, OPENAI_URL, OPENAI_CHAT_MODEL } from "@/lib/openai";
import type { SearchSource } from "@/lib/types";

export async function POST(request: NextRequest) {
  const { slug, storylineId, messages } = await request.json();

  if ((!slug && !storylineId) || !messages) {
    return NextResponse.json({ error: "Missing slug/storylineId or messages" }, { status: 400 });
  }

  let systemPrompt: string;

  if (storylineId) {
    const storyline = await getStorylineById(Number(storylineId));
    if (!storyline) {
      return NextResponse.json({ error: "Storyline not found" }, { status: 404 });
    }
    systemPrompt = buildStorylineSystemPrompt(storyline);
  } else {
    const article = await getArticleBySlug(slug);
    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }
    const markdown = (await getArticleContent(slug)) ?? article.summary;
    systemPrompt = buildSystemPrompt(markdown, article);
  }

  const input = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_CHAT_MODEL,
            stream: true,
            input,
            tools: [{ type: "web_search_preview" }],
            reasoning: { effort: "medium" },
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body from OpenAI");

        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";
        const sources = new Map<string, SearchSource>();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              eventType = "";
              continue;
            }

            if (trimmed.startsWith("event: ")) {
              eventType = trimmed.slice(7);
              continue;
            }

            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (
                eventType === "response.web_search_call.in_progress" ||
                eventType === "response.web_search_call.searching"
              ) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
                );
              } else if (eventType === "response.output_text.delta" && parsed.delta) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: parsed.delta })}\n\n`)
                );
              } else if (
                eventType === "response.output_text.annotation.added" &&
                parsed.annotation?.type === "url_citation" &&
                parsed.annotation.url
              ) {
                sources.set(parsed.annotation.url, {
                  title: parsed.annotation.title || parsed.annotation.url,
                  url: parsed.annotation.url,
                });
              }
            } catch {
              // Skip malformed JSON
            }
          }
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
