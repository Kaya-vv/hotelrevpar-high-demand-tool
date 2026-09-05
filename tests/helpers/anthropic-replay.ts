import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

export type ReplayEntry = {
  tool: "web_search" | "web_fetch";
  contains: string;
  message: unknown;
};

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
