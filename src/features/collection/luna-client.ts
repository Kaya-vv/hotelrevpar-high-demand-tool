// Answers the app's Anthropic Messages requests with OpenAI's GPT-6 Luna, so prompts, validation,
// quote checks and scoring run unchanged. This is the responder the 23 September 2026 comparison
// measured (scripts/luna-pipeline/translate.mjs). Anthropic's hosted web_fetch has no OpenAI
// equivalent; it becomes a local function tool that uses the app's own safe page fetcher, so the
// fetched text reaches the app's quote checks exactly as Anthropic's would.
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fetchOfficialPage, type PageFetcher } from "./official-pages";

export const LUNA_MODEL = "gpt-6-luna";
export const LUNA_FAST_MODEL = "gpt-6-luna:medium";

export type ResearchClient = {
  messages: {
    create: (params: MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }) => Promise<Anthropic.Message>;
  };
};

const WIRE_MODEL = "gpt-6-luna";
// Round 1 of the comparison used 8,192 including reasoning and ran out of room.
const MAX_OUTPUT_TOKENS = 32_000;
// Anthropic web_fetch max_content_tokens is 6,000 (~4 characters per token).
const PAGE_CHARS = 24_000;
const MAX_ROUNDS = 6;
const RESPONSES_URL = "https://api.openai.com/v1/responses";

export const LUNA_NOTE = [
  "Provider note: you are answering a request written for a different model. Follow the task exactly.",
  "Quote rule: every quoted evidence field (dateText, locationText, hostCityText, identityText, announcementText, evidenceText and each demand text) must be ONE unbroken passage copied character-for-character from ONE page. Never join separate lines or list entries, never insert \"...\" and never add words (such as an address) from elsewhere on the page. When the date and the place appear on different lines, quote each in its own field. locationText must be the passage that names this event's venue, hall or city (for example the location line of a listing), not just a street address.",
  "Tools: web search results are short snippets only. To read a page's full text, call the web_fetch function with a URL that appears in this task or in your search results. Respect the stated tool limits.",
  "Finish with the final JSON object only.",
].join("\n");

// Only the fields the translation reads; anything else in OpenAI's reply is ignored.
const responseSchema = z.object({
  id: z.string(),
  status: z.string(),
  incomplete_details: z.object({ reason: z.string().optional() }).nullish(),
  output: z.array(z.object({
    type: z.string(),
    name: z.string().optional(),
    call_id: z.string().optional(),
    arguments: z.string().optional(),
    action: z.object({
      type: z.string().optional(), query: z.string().optional(), url: z.string().optional(),
      sources: z.array(z.object({ url: z.string().optional() })).optional(),
    }).optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).nullish(),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    input_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullish(),
  }).nullish(),
});
const errorSchema = z.object({ error: z.object({ code: z.string().nullish(), message: z.string().nullish() }).nullish() });
type HttpError = Error & { status?: number };

function promptText(content: string | readonly Anthropic.ContentBlockParam[] | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((block) => block.type === "text" ? block.text
    : block.type === "document" && "data" in block.source && typeof block.source.data === "string" ? block.source.data : "").join("\n");
}
function fetchArgument(raw: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    return parsed && typeof parsed === "object" && "url" in parsed && typeof parsed.url === "string" ? parsed.url : null;
  } catch { return null; }
}
const normalizeUrl = (url: string) => {
  try { const parsed = new URL(url); parsed.hash = ""; return parsed.href.replace(/\/$/, "").toLowerCase(); } catch { return null; }
};
const toolId = () => `srvtoolu_${randomUUID().replaceAll("-", "")}`;

export function createLunaClient(deps: {
  apiKey?: string;
  fetchPage?: PageFetcher;
  transport?: typeof fetch;
  concurrency?: number;
  wait?: (ms: number) => Promise<void>;
} = {}): ResearchClient {
  const fetchPage = deps.fetchPage ?? fetchOfficialPage;
  const transport = deps.transport ?? fetch;
  const concurrency = deps.concurrency ?? 4;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // The organisation's tokens-per-minute limit (200,000 on 23 September 2026) is below the app's
  // 8 parallel requests at Luna's token use. Queue locally and wait out rejected (unbilled) 429s.
  let active = 0;
  const queued: (() => void)[] = [];
  const acquire = () => active < concurrency ? (active++, Promise.resolve()) : new Promise<void>((resolve) => queued.push(resolve));
  const releaseSlot = () => { const next = queued.shift(); if (next) next(); else active--; };

  async function post(body: object): Promise<z.infer<typeof responseSchema>> {
    const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for Luna research.");
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        const reply = await transport(RESPONSES_URL, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(600_000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Client-Request-Id": randomUUID() },
          body: JSON.stringify(body),
        });
        const json: unknown = await reply.json().catch(() => null);
        const error = errorSchema.safeParse(json).data?.error;
        const message = error?.message ?? "";
        // An empty account must stop the run at once: waiting cannot fix it.
        const outOfCredits = error?.code === "insufficient_quota" || /no credits remaining|exceeded your current quota/i.test(message);
        if (reply.status === 429 && !outOfCredits && attempt < 30) {
          const named = message.match(/try again in ([\d.]+)(ms|s)/);
          const seconds = named ? Number(named[1]) / (named[2] === "ms" ? 1000 : 1) : 5;
          await wait((seconds + 1 + Math.random() * 2) * 1000);
          continue;
        }
        if (!reply.ok) {
          const failure: HttpError = new Error(`OpenAI HTTP ${reply.status}: ${message || "no body"}`);
          failure.status = reply.status;
          throw failure;
        }
        return responseSchema.parse(json);
      }
    } finally { releaseSlot(); }
  }

  async function create(params: MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    if (params.messages.some((message) => message.role !== "user")) throw new Error("Multi-turn Anthropic conversations are not translated");
    // The ":medium" suffix only selects reasoning effort; both roles run the same model.
    const effort = params.model === LUNA_FAST_MODEL ? "medium" : "high";
    const tools = params.tools ?? [];
    const searchTool = tools.find((tool) => "type" in tool && typeof tool.type === "string" && tool.type.startsWith("web_search"));
    const fetchTool = tools.find((tool) => "type" in tool && typeof tool.type === "string" && tool.type.startsWith("web_fetch"));
    const location = searchTool && "user_location" in searchTool ? searchTool.user_location : null;
    let searchesLeft = searchTool && "max_uses" in searchTool ? searchTool.max_uses ?? 0 : 0;
    let fetchesLeft = fetchTool && "max_uses" in fetchTool ? fetchTool.max_uses ?? 0 : 0;
    const system = promptText(params.system);
    const prompt = [system, ...params.messages.map((message) => promptText(message.content))].filter(Boolean).join("\n\n");
    // Luna may only open pages the task named, a search returned or a fetched page linked to:
    // the same boundary Anthropic's hosted fetch enforces.
    const allowed = new Set([...prompt.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)]
      .map((match) => normalizeUrl(match[0].replace(/[.,;]+$/, ""))).filter((url): url is string => Boolean(url)));
    const schema = params.output_config?.format?.schema;
    // Non-strict: constraints stay, but the app's own Zod parse decides what is valid.
    const text = schema ? { format: { type: "json_schema", name: "answer", schema, strict: false } } : undefined;

    const content: object[] = [];
    let final: string | null = null;
    let previous: string | null = null;
    let input: unknown = prompt;
    let stopReason: "end_turn" | "max_tokens" = "end_turn";
    const usage = { input: 0, output: 0, cached: 0, searches: 0, fetches: 0 };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const searching = Boolean(searchTool) && searchesLeft > 0;
      const roundTools: object[] = [];
      if (searching) {
        roundTools.push({ type: "web_search", search_context_size: "medium",
          ...(location ? { user_location: { type: "approximate", country: location.country, city: location.city, timezone: location.timezone } } : {}) });
      }
      // Stays listed after its budget is spent, so earlier call outputs remain valid; further
      // calls receive Anthropic's max_uses_exceeded error instead of a page.
      if (fetchTool) roundTools.push({ type: "function", name: "web_fetch", strict: true,
        description: "Fetch the full text of a public web page. Only URLs that appear in the task or in search results are allowed.",
        parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } });
      const response = await post({
        model: WIRE_MODEL, service_tier: "default", store: true, max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort }, instructions: LUNA_NOTE, input, ...(previous ? { previous_response_id: previous } : {}),
        tools: roundTools, ...(searching ? { max_tool_calls: searchesLeft, include: ["web_search_call.action.sources"] } : {}),
        ...(text ? { text } : {}),
      });
      usage.input += response.usage?.input_tokens ?? 0;
      // Reasoning tokens are billed as output, so they stay in: this figure feeds real cost.
      usage.output += response.usage?.output_tokens ?? 0;
      usage.cached += response.usage?.input_tokens_details?.cached_tokens ?? 0;

      const outputs: object[] = [];
      for (const item of response.output ?? []) {
        if (item.type === "web_search_call") {
          const id = toolId();
          const sources = [...(item.action?.sources ?? []).map((source) => source.url), item.action?.url]
            .filter((url): url is string => Boolean(url));
          for (const url of sources) { const normal = normalizeUrl(url); if (normal) allowed.add(normal); }
          if (item.action?.type === "search") { searchesLeft--; usage.searches++; }
          content.push(
            { type: "server_tool_use", id, name: "web_search", input: { query: item.action?.query ?? item.action?.url ?? "" } },
            { type: "web_search_tool_result", tool_use_id: id,
              content: sources.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "", page_age: null })) },
          );
        } else if (item.type === "function_call" && item.name === "web_fetch") {
          const id = toolId();
          const url = fetchArgument(item.arguments);
          content.push({ type: "server_tool_use", id, name: "web_fetch", input: { url } });
          let result: object;
          let output: string;
          const normal = url ? normalizeUrl(url) : null;
          if (fetchesLeft <= 0) {
            result = { type: "web_fetch_tool_result_error", error_code: "max_uses_exceeded" };
            output = "Error: fetch limit reached.";
          } else if (!url || !normal || !allowed.has(normal)) {
            result = { type: "web_fetch_tool_result_error", error_code: "url_not_allowed" };
            output = "Error: URL not allowed; only URLs from the task or search results may be fetched.";
          } else {
            fetchesLeft--;
            try {
              const page = await fetchPage(url);
              const pageText = page.text.slice(0, PAGE_CHARS);
              for (const link of page.links ?? []) { const linked = normalizeUrl(link.url); if (linked) allowed.add(linked); }
              usage.fetches++;
              result = { type: "web_fetch_result", url: page.url ?? url, retrieved_at: new Date().toISOString(),
                content: { type: "document", source: { type: "text", media_type: "text/plain", data: pageText }, title: null } };
              output = `PAGE URL: ${page.url ?? url}\n${pageText}`;
            } catch (error) {
              result = { type: "web_fetch_tool_result_error", error_code: "unavailable" };
              output = `Error: page unavailable (${error instanceof Error ? error.message : String(error)}).`;
            }
          }
          content.push({ type: "web_fetch_tool_result", tool_use_id: id, content: result });
          outputs.push({ type: "function_call_output", call_id: item.call_id, output });
        } else if (item.type === "message") {
          const answer = (item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
          if (answer) final = answer;
        }
      }
      previous = response.id;
      if (response.status === "incomplete") {
        if (response.incomplete_details?.reason === "max_output_tokens") stopReason = "max_tokens";
        break;
      }
      if (response.status !== "completed" || !outputs.length) break;
      input = outputs;
    }
    if (final !== null) content.push({ type: "text", text: final });

    // Synthetic blocks mirror Anthropic's shapes closely enough for the app's readers; the SDK
    // types carry provider-only fields (citations, caller) that Luna has no equivalent for.
    return {
      id: `msg_luna_${randomUUID().replaceAll("-", "")}`, type: "message", role: "assistant", model: params.model, content,
      stop_reason: stopReason, stop_sequence: null,
      usage: {
        // Anthropic's input_tokens excludes cache reads; OpenAI's includes them. Split them so
        // cached tokens are priced once, at the cache-read rate.
        input_tokens: usage.input - usage.cached, output_tokens: usage.output, cache_creation_input_tokens: 0, cache_read_input_tokens: usage.cached,
        server_tool_use: { web_search_requests: usage.searches, web_fetch_requests: usage.fetches },
      },
    } as unknown as Anthropic.Message;
  }

  return { messages: { create } };
}
