import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { eventLocalDate } from "@/features/events/normalize";
import { readEventSizeCheck, type EventSizeCheck } from "@/features/events/size-check";
import { loadVisibleNotificationEvents } from "@/features/notifications/query";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";

import { estimatedCostUsd } from "./research-budget";
import type { CollectionContext } from "./run";
import { usageEvent, type ClaudeUsageEvent } from "./sources/claude";

/**
 * The model the owner reviewed on 29 September 2026: of 85 "Zelf beoordelen" events it called
 * 28 big, 31 small and 26 unknown, with one disputed answer (Anastacia, called small; the
 * scorer now lets quoted travelling-audience evidence overrule a "small").
 */
export const SIZE_CHECK_MODEL = "claude-sonnet-5";

const answerSchema = z.object({
  verdict: z.enum(["big", "small", "unsure"]),
  visitors: z.string(),
  reason: z.string(),
});

export type SizeCheckEvent = {
  id: string;
  title: string;
  category: string;
  venue: string | null;
  startAt: string;
  endAt: string;
};

export type SizeCheckResult = {
  state: "success" | "partial" | "zero" | "skipped";
  due: number;
  checked: number;
  failed: number;
  requests: number;
  reason?: string;
};

function prompt(event: SizeCheckEvent) {
  const startDate = eventLocalDate(event.startAt);
  const days = Math.round((Date.parse(eventLocalDate(event.endAt)) - Date.parse(startDate)) / 86_400_000) + 1;
  return `You help Dutch hotel revenue managers. Using only your own general knowledge (no browsing), judge whether this event causes noticeable extra hotel demand (many visitors from outside the region staying overnight) near its venue.

Event: ${event.title}
Category: ${event.category}
Dates: ${startDate}, ${days} day(s)
Venue: ${event.venue ?? "unknown"}

Use "big" only if you actually know this event and it typically draws thousands of overnight visitors from outside the region. Use "small" if you know it and it is mainly local, small, or day visitors. Use "unsure" if you do not know this specific event well. Never guess.
visitors: the rough total visitors of a typical edition, or "onbekend". reason: at most 20 words, in Dutch.`;
}

/** One request per event; a failed request leaves that event unchecked for the next run. */
export async function checkEventSizes(events: SizeCheckEvent[], options: {
  client: Pick<Anthropic, "messages">;
  model?: string;
  now?: Date;
  onUsage?: (usage: ClaudeUsageEvent) => Promise<void>;
}) {
  const model = options.model ?? SIZE_CHECK_MODEL;
  const checkedAt = (options.now ?? new Date()).toISOString();
  const checks = new Map<string, EventSizeCheck>();
  let failed = 0;
  const check = async (event: SizeCheckEvent) => {
    try {
      const message = await options.client.messages.create({
        model,
        max_tokens: 300,
        output_config: { format: zodOutputFormat(answerSchema) },
        messages: [{ role: "user", content: prompt(event) }],
      }, { timeout: 60_000, maxRetries: 2 });
      const usage = usageEvent(message, "size_check", model);
      usage.billingMode = "standard";
      usage.estimatedCostUsd = estimatedCostUsd(usage, false) ?? undefined;
      await options.onUsage?.(usage);
      const text = message.content.findLast((block) => block.type === "text")?.text;
      if (!text) throw new Error("Size check returned no answer.");
      const answer = answerSchema.parse(JSON.parse(text));
      checks.set(event.id, { version: 1, ...answer, model, checkedAt });
    } catch (error) {
      failed += 1;
      console.error(`Size check failed for ${event.title}:`, error);
    }
  };
  // Five at a time keeps a first run of a busy hotel (about 30 events) to a few seconds.
  for (let index = 0; index < events.length; index += 5) {
    await Promise.all(events.slice(index, index + 5).map(check));
  }
  return { checks, failed, requests: events.length };
}

/** Events this area's hotels see as "Zelf beoordelen" that have never been size-checked. */
async function dueSizeChecks(admin: AdminClient, context: CollectionContext): Promise<SizeCheckEvent[]> {
  const announced = new Set<string>();
  for (const hotel of context.hotels) {
    const visible = await loadVisibleNotificationEvents(admin, context.area.accountId, hotel.id);
    for (const event of visible?.events ?? []) if (event.announced) announced.add(event.id);
  }
  if (!announced.size) return [];
  const rows = await fetchInBatches([...announced], (ids) =>
    admin.from("events").select("id, title, category, venue, start_at, end_at, size_check").in("id", ids));
  return rows.filter((row) => !readEventSizeCheck(row.size_check)).map((row) => ({
    id: row.id, title: row.title, category: row.category, venue: row.venue, startAt: row.start_at, endAt: row.end_at,
  }));
}

export async function runSizeChecks(
  context: CollectionContext,
  onUsage: (usage: ClaudeUsageEvent) => Promise<void>,
): Promise<SizeCheckResult> {
  const admin = createAdminClient();
  const due = await dueSizeChecks(admin, context);
  if (!due.length) return { state: "zero", due: 0, checked: 0, failed: 0, requests: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { state: "skipped", due: due.length, checked: 0, failed: 0, requests: 0, reason: "ANTHROPIC_API_KEY ontbreekt." };
  const { checks, failed, requests } = await checkEventSizes(due, { client: new Anthropic({ apiKey }), onUsage });
  for (const [eventId, check] of checks) {
    // Another area's run may have checked the same shared event meanwhile; keep the first answer.
    const { error } = await admin.from("events").update({ size_check: check }).eq("id", eventId).is("size_check", null);
    if (error) throw error;
  }
  return { state: failed ? "partial" : "success", due: due.length, checked: checks.size, failed, requests };
}
