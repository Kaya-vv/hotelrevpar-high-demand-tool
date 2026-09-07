import { expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import rejected from "../../../tests/fixtures/long-range-schema-rejection.json";
import { editionWireSchema } from "./sources/long-range";
import { eventWireOutputSchema } from "./sources/claude";

function complexity(schema: unknown) {
  let optional = 0, unions = 0;
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.properties) optional += Object.keys(node.properties).filter((key) => !(node.required as string[] ?? []).includes(key)).length;
    if (node.anyOf || node.oneOf || Array.isArray(node.type)) unions++;
    Object.values(node).forEach(visit);
  }
  visit(schema);
  return { optional, unions };
}

it("removes the schema complexity that rejected real extraction requests", () => {
  expect(rejected.error.message).toContain("compiled grammar is too large");
  const previous = complexity(rejected.schema);
  for (const output of [editionWireSchema, eventWireOutputSchema]) {
    const next = complexity(zodOutputFormat(output).schema);
    expect(next.optional).toBe(0);
    expect(next.unions).toBeLessThanOrEqual(16);
    expect(next.optional + next.unions).toBeLessThan(previous.optional + previous.unions);
  }
  // Provider compilation itself still needs a newly authorised live evaluation.
});
