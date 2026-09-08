import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import fixture from "../../../tests/fixtures/the-match-repair.json";
import { CLAUDE_ASSESSMENT_VERSION } from "./anthropic-batches";
import { createCollectionRepository } from "./repository";
import { collectionWindow, runCollection } from "./run";
import { getCalendarData } from "../calendar/query";
import { getHotelScope } from "../workspace/hotel-context";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("../workspace/hotel-context", () => ({ getHotelScope: vi.fn() }));

it.skipIf(!process.env.RESEARCH_LOCAL_KEY)("shares fresh public evidence across accounts before discovery, preserving decisions and freshness", async () => {
  const networkFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://127.0.0.1:54421") throw new Error(`External network disabled: ${url.origin}`);
    return networkFetch(input, init);
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY!, { auth: { persistSession: false } });
  const checked = <T,>(result: { data: T; error: unknown }) => { if (result.error) throw result.error; return result.data; };
  const accounts = [randomUUID(), randomUUID()];
  const ids = Array.from({ length: 8 }, () => randomUUID());
  const [fresh, excluded, stale, outside, oldVersion, cancelled, conflict, beyondWindow] = ids;
  const now = new Date().toISOString();
  const start = new Date(Date.now() + 20 * 86400000).toISOString();
  const end = new Date(Date.now() + 22 * 86400000).toISOString();
  const baseEvent = fixture.baseline.events.find((row) => row.title === "Fuzz Club Festival 2027")!;
  const baseSource = fixture.baseline.sources.find((row) => row.event_id === baseEvent.id)!;
  try {
    checked(await db.from("accounts").insert(accounts.map((id) => ({ id, name: "Shared evidence test" }))));
    const hotels = checked(await db.from("hotels").insert(accounts.map((account_id) => ({
      account_id, name: "Shared evidence hotel", revcontrol_code: "TEST", latitude: 51.44, longitude: 5.48,
      demand_radius_km: 25, search_location: "Eindhoven", enabled_sources: ["claude"],
    }))).select().order("account_id"))!;
    const owner = hotels.find((hotel) => hotel.account_id === accounts[0])!;
    const client = hotels.find((hotel) => hotel.account_id === accounts[1])!;
    const areas = checked(await db.from("collection_areas").select("id, hotel_id").in("hotel_id", hotels.map((hotel) => hotel.id)))!;
    const ownerArea = areas.find((area) => area.hotel_id === owner.id)!;
    const clientArea = areas.find((area) => area.hotel_id === client.id)!;
    const events = ids.map((id) => ({ ...baseEvent, id, title: `Shared evidence ${id}`, latitude: id === outside ? 52.4 : 51.44,
      longitude: 5.48, start_at: id === beyondWindow ? "2035-01-01T00:00:00Z" : start,
      end_at: id === beyondWindow ? "2035-01-02T00:00:00Z" : end }));
    checked(await db.from("events").insert(events as Database["public"]["Tables"]["events"]["Insert"][]));
    checked(await db.from("event_sources").insert(events.map((event) => ({ ...baseSource, id: randomUUID(), event_id: event.id,
      provider_event_id: `test:${event.id}`, extracted_start_at: event.start_at, extracted_end_at: event.end_at,
      checked_at: event.id === stale ? "2020-01-01T00:00:00Z" : now,
      assessment_version: event.id === oldVersion ? 0 : CLAUDE_ASSESSMENT_VERSION,
      source_state: event.id === cancelled ? "cancelled" : "active",
    })) as Database["public"]["Tables"]["event_sources"]["Insert"][]));
    // The owner's exclusion must not exclude the client's event; the client's own exclusion must survive.
    checked(await db.from("account_events").insert(ids.map((event_id) => ({ account_id: owner.account_id, event_id,
      state: event_id === conflict ? "needs_review" as const : "excluded" as const,
      review_reason: event_id === conflict ? "date_conflict" : null }))));
    checked(await db.from("account_event_areas").insert(ids.map((event_id) => ({ account_id: owner.account_id, collection_area_id: ownerArea.id, event_id }))));
    checked(await db.from("account_events").insert({ account_id: client.account_id, event_id: excluded, state: "excluded" }));
    const repo = createCollectionRepository();
    const context = await repo.loadContext(client.account_id, clientArea.id);
    expect(context.knownEvents).toEqual([]);
    expect(await repo.reuseNearTermEvidence!({ ...context, area: { ...context.area, enabledSources: [] } })).toBe(0);
    expect(await repo.reuseNearTermEvidence!({ ...context, hotels: context.hotels.map((hotel) => ({ ...hotel, latitude: 51.5, demandRadiusKm: 1 })) })).toBe(0);
    const collector = vi.fn(async (loaded: typeof context) => {
      expect(loaded.knownEvents.map((event) => event.title)).toContain(`Shared evidence ${fresh}`);
      expect(loaded.window).toEqual(collectionWindow());
      expect(checked(await db.from("hotel_event_scores").select("event_id").eq("hotel_id", client.id))!.map((row) => row.event_id)).toContain(fresh);
      return { source: "claude" as const, candidates: [], requests: 0, usage: {} };
    });
    await runCollection({ accountId: client.account_id, areaId: clientArea.id, trigger: "manual" }, { repository: repo, collectors: { claude: collector } });
    expect(collector).toHaveBeenCalledOnce();
    const linked = checked(await db.from("account_event_areas").select("event_id").eq("collection_area_id", clientArea.id))!;
    expect(linked.map((row) => row.event_id).sort()).toEqual([fresh, excluded].sort());
    const decisions = checked(await db.from("account_events").select("event_id, state").eq("account_id", client.account_id))!;
    expect(decisions.find((row) => row.event_id === fresh)?.state).toBe("active");
    expect(decisions.find((row) => row.event_id === excluded)?.state).toBe("excluded");
    const { createServerClient } = await import("@/lib/supabase/server");
    vi.mocked(createServerClient).mockResolvedValue(db);
    vi.mocked(getHotelScope).mockResolvedValue({ supabase: db, hotels: [client], selectedHotelId: client.id,
      areaId: clientArea.id, enabledSources: ["claude"] } as Awaited<ReturnType<typeof getHotelScope>>);
    const calendar = await getCalendarData(client.account_id, { month: start.slice(0, 7) });
    expect(calendar.events.map((event) => event.id)).toContain(fresh);
    expect(calendar.events.map((event) => event.id)).not.toContain(excluded);
    expect(await repo.reuseNearTermEvidence!(context)).toBe(0);
    const source = checked(await db.from("event_sources").select("checked_at, assessment_version").eq("event_id", fresh).single())!;
    expect(Date.parse(source.checked_at)).toBe(Date.parse(now));
    expect(source.assessment_version).toBe(CLAUDE_ASSESSMENT_VERSION);
  } finally {
    await db.from("accounts").delete().in("id", accounts);
    await db.from("events").delete().in("id", ids);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
}, 60_000);
