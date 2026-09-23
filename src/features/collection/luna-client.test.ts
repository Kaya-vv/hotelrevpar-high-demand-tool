import { describe, expect, it, vi } from "vitest";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { createLunaClient, LUNA_FAST_MODEL, LUNA_MODEL, LUNA_NOTE } from "./luna-client";
import type { OfficialPage } from "./official-pages";

// Responses API payload shapes as returned by gpt-6-luna during the 23 September 2026 comparison.
const answer = (text: string, extra: object[] = []) => ({
  id: `resp_${Math.random().toString(36).slice(2)}`, status: "completed", incomplete_details: null,
  output: [...extra, { type: "message", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 7_500, output_tokens: 2_100, input_tokens_details: { cached_tokens: 0 } },
});
const searchCall = (sources: string[]) => ({ type: "web_search_call", action: { type: "search", query: "evenementen Eindhoven", sources: sources.map((url) => ({ url })) } });
const fetchCall = (url: string) => ({ type: "function_call", name: "web_fetch", call_id: `call_${url.length}`, arguments: JSON.stringify({ url }) });
const toolRound = (items: object[]) => ({ id: `resp_tool_${items.length}`, status: "completed", incomplete_details: null, output: items,
  usage: { input_tokens: 3_000, output_tokens: 400, input_tokens_details: { cached_tokens: 1_000 } } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function harness(replies: Response[], page?: (url: string) => Promise<OfficialPage>) {
  const bodies: Record<string, unknown>[] = [];
  const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies.shift();
    if (!reply) throw new Error("No recorded reply left");
    return reply;
  });
  const fetchPage = vi.fn(page ?? (async (url: string) => ({ url, text: "", links: [] })));
  const wait = vi.fn(async () => {});
  const client = createLunaClient({ apiKey: "test-key", transport: transport as unknown as typeof fetch, fetchPage, wait });
  return { client, bodies, transport, fetchPage, wait };
}

const schema = { type: "object", properties: { events: { type: "array" } }, required: ["events"] };
const request = (overrides: Partial<MessageCreateParamsNonStreaming> = {}): MessageCreateParamsNonStreaming => ({
  model: LUNA_MODEL, max_tokens: 4_000,
  output_config: { format: { type: "json_schema", schema } },
  messages: [{ role: "user", content: "First fetch this observed official source: https://organizer.example/agenda" }],
  ...overrides,
});
const fetchTool = { type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: 2 };
const searchTool = { type: "web_search_20260318" as const, name: "web_search" as const, max_uses: 1 };

describe("Luna research client", () => {
  it.each([[LUNA_MODEL, "high"], [LUNA_FAST_MODEL, "medium"]])("sends %s to gpt-6-luna with effort %s, the note and the answer schema", async (model, effort) => {
    const test = harness([json(answer('{"events":[]}'))]);
    const message = await test.client.messages.create(request({ model }));
    expect(test.bodies[0]).toMatchObject({
      model: "gpt-6-luna", max_output_tokens: 32_000, reasoning: { effort }, instructions: LUNA_NOTE,
      text: { format: { type: "json_schema", name: "answer", schema, strict: false } },
    });
    expect(message.model).toBe(model);
    expect(message.content.at(-1)).toEqual({ type: "text", text: '{"events":[]}' });
  });

  it("drops the search tool once its uses are spent", async () => {
    const test = harness([
      json(toolRound([searchCall(["https://organizer.example/agenda"]), fetchCall("https://organizer.example/agenda")])),
      json(answer('{"events":[]}')),
    ]);
    const message = await test.client.messages.create(request({ tools: [searchTool, fetchTool] }));
    const toolTypes = (index: number) => (test.bodies[index].tools as { type: string }[]).map((tool) => tool.type);
    expect(toolTypes(0)).toEqual(["web_search", "function"]);
    expect(test.bodies[0].max_tool_calls).toBe(1);
    expect(toolTypes(1)).toEqual(["function"]);
    expect(message.usage.server_tool_use).toEqual({ web_search_requests: 1, web_fetch_requests: 1 });
  });

  it("refuses to fetch a page the task and searches never named", async () => {
    const test = harness([json(toolRound([fetchCall("https://elsewhere.example/page")])), json(answer('{"events":[]}'))]);
    const message = await test.client.messages.create(request({ tools: [fetchTool] }));
    expect(test.fetchPage).not.toHaveBeenCalled();
    expect(message.content).toContainEqual(expect.objectContaining({
      type: "web_fetch_tool_result", content: { type: "web_fetch_tool_result_error", error_code: "url_not_allowed" },
    }));
    expect(test.bodies[1].input).toEqual([expect.objectContaining({ type: "function_call_output", output: expect.stringContaining("not allowed") })]);
  });

  it("returns a fetched page as Anthropic web_fetch evidence, cut at 24,000 characters", async () => {
    const pageUrl = "https://organizer.example/agenda";
    const text = "Arts Week 21-23 May 2027. ".repeat(1_200);
    const test = harness([json(toolRound([fetchCall(pageUrl)])), json(answer('{"events":[]}'))], async (url) => ({ url, text, links: [] }));
    const message = await test.client.messages.create(request({ tools: [fetchTool] }));
    const result = message.content.find((block) => block.type === "web_fetch_tool_result");
    expect(result).toMatchObject({ content: { type: "web_fetch_result", url: pageUrl, content: { type: "document", source: { data: text.slice(0, 24_000) } } } });
    expect(message.usage.server_tool_use?.web_fetch_requests).toBe(1);
    // OpenAI counts cached tokens inside input_tokens; Anthropic's shape keeps them apart.
    expect(message.usage).toMatchObject({ input_tokens: 3_000 - 1_000 + 7_500, cache_read_input_tokens: 1_000, output_tokens: 2_500 });
  });

  it("reports a cut-off answer as max_tokens", async () => {
    const test = harness([json({ ...answer('{"events":['), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })]);
    const message = await test.client.messages.create(request());
    expect(message.stop_reason).toBe("max_tokens");
  });

  it("waits out a rate limit, but stops at once when the account is out of credit", async () => {
    const limited = harness([
      json({ error: { code: "rate_limit_exceeded", message: "Rate limit reached. Please try again in 2s." } }, 429),
      json(answer('{"events":[]}')),
    ]);
    await expect(limited.client.messages.create(request())).resolves.toMatchObject({ stop_reason: "end_turn" });
    expect(limited.wait).toHaveBeenCalledTimes(1);
    const [delay] = limited.wait.mock.calls[0] as unknown as [number];
    expect(delay).toBeGreaterThanOrEqual(3_000);
    expect(delay).toBeLessThanOrEqual(5_000);

    const empty = harness([json({ error: { code: "insufficient_quota", message: "You exceeded your current quota." } }, 429)]);
    await expect(empty.client.messages.create(request())).rejects.toMatchObject({ status: 429 });
    expect(empty.transport).toHaveBeenCalledTimes(1);
    expect(empty.wait).not.toHaveBeenCalled();
  });
});
