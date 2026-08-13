import { NextRequest } from "next/server";
import { buildGlobalSystemPrompt } from "@/lib/chat";
import { askTools, executeAskTool } from "@/lib/ask-tools";
import { getCorpusCoverage } from "@/lib/db/queries";
import { OPENAI_API_KEY, OPENAI_URL, OPENAI_CHAT_MODEL } from "@/lib/openai";
import type { SearchSource } from "@/lib/types";

/**
 * Ceiling on model turns in one reply.
 *
 * A turn is one round trip: the model either answers or asks for a tool. Two
 * or three is the normal shape — search, maybe search again with better terms,
 * answer — and the cap exists only so a model that keeps searching without
 * concluding cannot bill an unbounded number of round trips against a single
 * question.
 */
const MAX_TURNS = 6;

/**
 * Ceiling on tool calls across a whole reply.
 *
 * Turns alone are not a budget: the model issues several calls per turn, and
 * an observed run spent 17 of them — thirteen searches, five of which returned
 * nothing — before answering. Each search costs a query embedding against a
 * 1,000-per-day allowance, so an unbounded appetite for searching is what
 * would actually exhaust the free tier. Past this the model is told to answer
 * with what it has, rather than the reply being truncated.
 *
 * Set with headroom above the two or three searches a normal question takes,
 * because cutting in mid-investigation produces a visibly hedged answer.
 */
const MAX_TOOL_CALLS = 14;

/** An output item from the Responses API. Only `function_call` is inspected. */
interface OutputItem {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

export async function POST(request: NextRequest) {
  const { messages } = await request.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Missing messages" }, { status: 400 });
  }

  const coverage = await getCorpusCoverage();

  const input: unknown[] = [
    { role: "system", content: buildGlobalSystemPrompt(coverage ?? undefined) },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      // Web citations accumulate across every turn, so they are collected here
      // and flushed once rather than per turn.
      const sources = new Map<string, SearchSource>();
      // Searches overlap heavily — the same article surfaces for several
      // phrasings — so slugs already sent are not sent again.
      const sentArticles = new Set<string>();
      let toolCalls = 0;

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const withinBudget = toolCalls < MAX_TOOL_CALLS;
          const output = await streamTurn(input, send, sources, withinBudget);

          // Tools were withheld, so this turn is the answer by construction.
          if (!withinBudget) break;

          // Everything the turn produced goes back verbatim, reasoning items
          // included — dropping those costs the model its chain of thought
          // across the tool call it just asked for.
          input.push(...output);

          const calls = output.filter(
            (item): item is OutputItem & { call_id: string; name: string } =>
              item.type === "function_call" && !!item.call_id && !!item.name
          );

          // No tool requested means the model answered; the reply is complete.
          if (calls.length === 0) break;

          for (const call of calls) {
            const result = await executeAskTool(call.name, call.arguments ?? "{}");
            toolCalls++;

            const fresh = (result.articles ?? []).filter((a) => !sentArticles.has(a.slug));
            for (const a of fresh) sentArticles.add(a.slug);

            send({
              step: { tool: call.name, detail: result.detail },
              ...(fresh.length ? { articles: fresh } : {}),
            });

            input.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: result.output,
            });
          }

          if (turn === MAX_TURNS - 1) {
            console.warn("[ask] Turn limit reached with tools still pending");
          }
        }

        if (sources.size > 0) send({ sources: [...sources.values()] });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[ask] Stream error:", message);
        send({ error: message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Streams one model turn, forwarding text to the client as it arrives, and
 * returns the turn's completed output items.
 *
 * The items come from `response.completed` rather than being assembled from
 * `function_call_arguments` deltas. That event carries the finished output
 * array exactly as a non-streaming call would return it — and the deltas'
 * matching `.done` event omits the function name entirely, so reconstructing
 * calls from them would mean tracking names separately for no gain.
 */
async function streamTurn(
  input: unknown[],
  send: (payload: unknown) => void,
  sources: Map<string, SearchSource>,
  allowTools: boolean
): Promise<OutputItem[]> {
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
      tools: [...askTools, { type: "web_search_preview" }],
      // The budget is enforced with tool_choice, not by withholding the tool
      // definitions. Removing them makes the model emit raw call syntax —
      // `to=functions.get_article`, `multi_tool_use.parallel` — as literal
      // answer text, because it still intends to call a tool and no longer has
      // a channel for it. Declared-but-forbidden is a state it understands.
      tool_choice: allowTools ? "auto" : "none",
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
  let output: OutputItem[] = [];

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

        // Parsing is guarded on its own so that a failure raised while
        // handling an event is not mistaken for malformed SSE and swallowed.
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (
          eventType === "response.web_search_call.in_progress" ||
          eventType === "response.web_search_call.searching"
        ) {
          send({ searching: true });
        } else if (eventType === "response.output_text.delta" && parsed.delta) {
          send({ text: parsed.delta });
        } else if (
          eventType === "response.output_text.annotation.added" &&
          parsed.annotation?.type === "url_citation" &&
          parsed.annotation.url
        ) {
          sources.set(parsed.annotation.url, {
            title: parsed.annotation.title || parsed.annotation.url,
            url: parsed.annotation.url,
          });
        } else if (eventType === "response.completed" && parsed.response?.output) {
          output = parsed.response.output as OutputItem[];
        } else if (eventType === "response.failed" || eventType === "error") {
          throw new Error(
            parsed.response?.error?.message ?? parsed.message ?? "Model turn failed"
          );
        }
    }
  }

  return output;
}
