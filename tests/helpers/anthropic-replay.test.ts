import { expect, it } from "vitest";
import { replayRecordedAnthropic } from "./anthropic-replay";

const params = { model: "recorded-model", max_tokens: 100, messages: [{ role: "user" as const, content: "Discover events in this area" }] };

it("replays exact requests independent of object key order", async () => {
  const replay = replayRecordedAnthropic([{ params, response: { id: "recorded" } }]);
  expect(await replay.client.messages.create({ messages: params.messages, max_tokens: 100, model: params.model })).toEqual({ id: "recorded" });
  expect(() => replay.assertComplete()).not.toThrow();
});

it("rejects changed evidence, prompts and models even if a collector catches the error", async () => {
  for (const change of [{ model: "different-model" }, { messages: [{ role: "user" as const, content: "Discover events in this area. Supplied hotel evidence" }] }, { max_tokens: 200 }]) {
    const replay = replayRecordedAnthropic([{ params, response: { id: "recorded" } }]);
    await expect(replay.client.messages.create({ ...params, ...change })).rejects.toThrow("No exact recorded");
    expect(replay.integrityErrors).toHaveLength(1);
    expect(() => replay.assertComplete()).toThrow("Invalid replay");
  }
});

it("rejects missing work and consuming a recorded response twice", async () => {
  const replay = replayRecordedAnthropic([{ params, response: {} }]);
  expect(() => replay.assertComplete()).toThrow("1 unused responses");
  await replay.client.messages.create(params);
  await expect(replay.client.messages.create(params)).rejects.toThrow();
  expect(() => replay.assertComplete()).toThrow();
});
