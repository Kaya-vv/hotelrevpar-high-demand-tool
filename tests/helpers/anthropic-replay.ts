import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

export type ReplayEntry = {
  tool: "web_search" | "web_fetch";
  contains: string;
  message: unknown;
};

export type RecordedMessage = { params: MessageCreateParamsNonStreaming; response: unknown };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Exact recorded provider requests only. This validates deterministic downstream
 * behavior, never the likelihood of a fresh search returning the same evidence. */
export function replayRecordedAnthropic(entries: RecordedMessage[]) {
  const remaining = structuredClone(entries);
  const requests: MessageCreateParamsNonStreaming[] = [];
  const integrityErrors: string[] = [];
  const client = { messages: { create: async (request: MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(request));
    const index = remaining.findIndex(entry => canonical(entry.params) === canonical(request));
    if (index < 0) {
      const error = "No exact recorded provider request; replay cannot validate changed prompts, models, tools or input evidence.";
      integrityErrors.push(error);
      throw new Error(error);
    }
    return remaining.splice(index, 1)[0].response;
  } } } as unknown as Anthropic;
  return { client, requests, integrityErrors, assertComplete: () => {
    if (integrityErrors.length || remaining.length) throw new Error(`Invalid replay: ${integrityErrors.length} unmatched requests, ${remaining.length} unused responses`);
  } };
}

/** Offline orchestration regression only: old responses cannot validate new prompt behavior. */
export function replayAnthropic(entries: ReplayEntry[]) {
  const remaining = [...entries];
  const requests: MessageCreateParamsNonStreaming[] = [];
  const client = { messages: { create: async (request: MessageCreateParamsNonStreaming) => {
    requests.push(request);
    const text = JSON.stringify(request.messages);
    const firstTool = request.tools?.[0];
    const tool = firstTool && "name" in firstTool ? firstTool.name : undefined;
    const index = remaining.findIndex((entry) => entry.tool === tool && text.includes(entry.contains));
    if (index < 0) throw new Error(`Replay has no recorded response for ${tool}; network access is disabled.`);
    return structuredClone(remaining.splice(index, 1)[0].message);
  } } } as unknown as Anthropic;
  return { client, requests, remaining: () => remaining.length };
}
