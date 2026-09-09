import { getSourceHealthSummaries, getSourceHealthRuns } from "@/features/accounts/source-health";
import { getMarketStatus } from "@/features/collection/market-status";
import { getDashboardData } from "@/features/dashboard/query";
import { getCollectionStatus } from "@/features/collection/status";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createExport, type ExportRequest } from "./create";
import { exportRange, loadExportEvents } from "./query";
import { loadExportHistory } from "./history";
import { exportSnapshots, selectExportEvents } from "./selection";
import { buildRevControlWorkbook } from "./build-workbook";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
const enabled = Boolean(process.env.RESEARCH_LOCAL_KEY);
const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY ?? "disabled", { auth: { persistSession: false } });
const accountId = randomUUID(), otherAccount = randomUUID(), hotelId = randomUUID(), secondHotel = randomUUID();
let userId: string, otherUserId: string;
let member: ReturnType<typeof createClient<Database>>;
const eventIds: string[] = [];
const marketKeys: string[] = [];
const password = randomUUID();
function check<T extends { error: unknown }>(result: T): T { if (result.error) throw result.error; return result; }

beforeAll(async () => {
  if (!enabled) return;
  const email = `${randomUUID()}@export.test`;
  userId = check(await db.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
  otherUserId = check(await db.auth.admin.createUser({ email: `${randomUUID()}@export.test`, password, email_confirm: true })).data.user!.id;
  check(await db.from("accounts").insert([{ id: accountId, name: "Export test" }, { id: otherAccount, name: "Other" }]));
  check(await db.from("account_members").insert([{ account_id: accountId, user_id: userId, role: "operator" }, { account_id: otherAccount, user_id: otherUserId, role: "operator" }]));
  for (const id of [hotelId, secondHotel]) check(await db.from("hotels").insert({ id, account_id: accountId, name: id, revcontrol_code: id, latitude: 51.44, longitude: 5.48, demand_radius_km: 25, search_location: "Eindhoven", enabled_sources: ["claude"] }));
  member = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY!, { auth: { persistSession: false } });
  check(await member.auth.signInWithPassword({ email, password }));
  const { createServerClient } = await import("@/lib/supabase/server");
  vi.mocked(createServerClient).mockResolvedValue(member);
});
afterAll(async () => {
  if (!enabled) return;
  check(await db.from("accounts").delete().in("id", [accountId, otherAccount]));
  if (marketKeys.length) check(await db.from("long_range_markets").delete().in("market_key", marketKeys));
  if (eventIds.length) check(await db.from("events").delete().in("id", eventIds));
  if (userId) check(await db.auth.admin.deleteUser(userId));
  if (otherUserId) check(await db.auth.admin.deleteUser(otherUserId));
});

async function addEvent(level = "High") {
  const id = randomUUID(); eventIds.push(id);
  check(await db.from("events").insert({ id, normalized_identity: id, title: id, category: "concert", start_at: "2027-06-10T12:00:00+02:00", end_at: "2027-06-10T23:00:00+02:00", certainty: "confirmed" }));
  check(await db.from("account_events").insert({ account_id: accountId, event_id: id, state: "active" }));
  check(await db.from("event_sources").insert({ event_id: id, provider: "claude", provider_event_id: id, source_url: "https://arena.example/events", public_source_url: "https://arena.example/events", extracted_title: id, extracted_start_at: "2027-06-10T12:00:00+02:00", source_state: "active", certainty: "confirmed", primary_source_confirmed: true, evidence: { dateText: "10 June 2027", locationText: "Eindhoven", hostCity: "Eindhoven", locationScope: "venue", continuous: false, majorCompetition: false, demand: [], dateSourceUrl: "https://arena.example/events", checkedAt: "2026-09-09" } }));
  const areas = check(await db.from("collection_areas").select("id").eq("account_id", accountId)).data!;
  check(await db.from("account_event_areas").insert(areas.map((area) => ({ account_id: accountId, event_id: id, collection_area_id: area.id }))));
  check(await db.from("hotel_event_scores").insert([hotelId, secondHotel].map((hotel) => ({ hotel_id: hotel, event_id: id, distance_km: 1, impact_points: 45, distance_points: 20, stay_pressure_points: 0, total: 65, suggested_importance: level, impact_basis: "demand_rule", demand_assessment: { version: 1, relevance: "supported", magnitude: level, confidence: "high", reasons: [], sourceUrls: [] } }))));
  return id;
}
const input = (id: string, mode: "new" | "selected" | "all" = "new"): ExportRequest => ({ requestKey: randomUUID(), from: "2027-01-01", to: "2027-12-31", hotelIds: [hotelId], mode, selectedPairs: mode === "selected" ? [`${hotelId}:${id}`] : [], choices: [] });
function deps(id: string) {
  return {
    find: async (key: string) => check(await db.from("export_batches").select("id, request_hash").eq("account_id", accountId).eq("request_key", key).maybeSingle()).data,
    load: async (request: ExportRequest) => (await loadExportEvents(accountId, { start: request.from, end: request.to }, request.hotelIds)).events.filter((event) => event.id === id),
    commit: async (request: ExportRequest, hash: string, bytes: Buffer, items: unknown) => check(await db.rpc("commit_hotel_export", { p_account: accountId, p_user: userId, p_key: request.requestKey, p_hash: hash, p_selection: request as Json, p_workbook: bytes.toString("base64"), p_items: items as Json, p_choices: request.choices as Json })).data!,
  };
}

describe.skipIf(!enabled)("export transactions in isolated local Supabase", () => {
  it("serializes competing exports, and returns identical bytes on retries and downloads after edits", async () => {
    const id = await addEvent();
    const results = await Promise.allSettled([createExport(input(id), deps(id)), createExport(input(id), deps(id))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const claim = check(await db.from("hotel_event_exports").select("*").eq("hotel_id", hotelId).eq("event_id", id).single()).data!;
    const batch = check(await db.from("export_batches").select("*").eq("id", claim.first_batch_id).single()).data!;
    check(await db.from("events").update({ title: "Updated concert" }).eq("id", id));
    expect(await createExport(batch.selection as ExportRequest, deps(id))).toBe(batch.id);
    expect(check(await member.from("export_batches").select("workbook").eq("id", batch.id).single()).data!.workbook).toBe(batch.workbook);
    const events = (await loadExportEvents(accountId, exportRange("2027-01-01", "2027-12-31"), [hotelId, secondHotel])).events.filter((event) => event.id === id);
    expect(selectExportEvents(events, "new", [], [])[0].hotels.map((hotel) => hotel.id)).toEqual([secondHotel]);
    const history = await loadExportHistory(accountId, [hotelId], events);
    expect(history.find((entry) => entry.id === batch.id)!.items[0]).toMatchObject({ latest: true, changed: true });
    const reexport = input(id, "selected");
    const repeated = await Promise.all([createExport(reexport, deps(id)), createExport(reexport, deps(id))]);
    expect(repeated[0]).toBe(repeated[1]);
  });
  it("filters effective override dates and permits explicit announcement levels without altering scores", async () => {
    const id = await addEvent("Medium");
    check(await db.from("account_events").update({ override_start_at: "2027-08-01T12:00:00+02:00", override_end_at: "2027-08-03T12:00:00+02:00" }).eq("account_id", accountId).eq("event_id", id));
    const inAugust = (await loadExportEvents(accountId, { start: "2027-08-02", end: "2027-08-02" }, [hotelId])).events;
    expect(inAugust.some((event) => event.id === id)).toBe(true);
    expect((await loadExportEvents(accountId, { start: "2027-06-01", end: "2027-06-30" }, [hotelId])).events.some((event) => event.id === id)).toBe(false);
    expect(selectExportEvents(inAugust.filter((event) => event.id === id), "new", [], [])).toEqual([]);
    const request = { ...input(id), selectedPairs: [`${hotelId}:${id}`], choices: [{ eventId: id, hotelId, importance: "Low" as const }] };
    await createExport(request, deps(id));
    expect(check(await db.from("hotel_event_scores").select("suggested_importance").eq("hotel_id", hotelId).eq("event_id", id).single()).data!.suggested_importance).toBe("Medium");
    expect(check(await db.from("announcement_export_choices").select("importance").eq("hotel_id", hotelId).eq("event_id", id).single()).data!.importance).toBe("Low");
  });
  it("rolls back the entire batch on a bad choice and denies foreign accounts and direct client commits", async () => {
    const id = await addEvent(); const request = input(id);
    const bytes = Buffer.from("test workbook");
    const snapshots = exportSnapshots(await deps(id).load(request));
    const invalid = await db.rpc("commit_hotel_export", { p_account: accountId, p_user: userId, p_key: request.requestKey, p_hash: "bad", p_selection: request as Json, p_workbook: bytes.toString("base64"), p_items: snapshots as unknown as Json, p_choices: [{ eventId: randomUUID(), hotelId, importance: "Low" }] });
    expect(invalid.error).toBeTruthy();
    expect(invalid.error?.message).toContain("Choice is not part of export");
    expect(check(await db.from("export_batches").select("id").eq("request_key", request.requestKey)).data).toEqual([]);
    expect(check(await db.from("hotel_event_exports").select("event_id").eq("hotel_id", hotelId).eq("event_id", id)).data).toEqual([]);
    const args = { p_account: accountId, p_user: otherUserId, p_key: request.requestKey, p_hash: "x", p_selection: request as Json, p_workbook: "eA==", p_items: [], p_choices: [] };
    expect((await db.rpc("commit_hotel_export", args)).error?.code).toBe("42501");
    expect((await member.rpc("commit_hotel_export", { ...args, p_user: userId })).error?.code).toBe("42501");
    expect(check(await member.from("accounts").select("id").eq("id", otherAccount)).data).toEqual([]);
    const foreign = check(await db.from("export_batches").insert({ account_id: otherAccount, created_by: otherUserId, request_key: randomUUID(), request_hash: "foreign", selection: {}, workbook: "\\x0102" }).select("id").single()).data!;
    expect(check(await member.from("export_batches").select("workbook").eq("id", foreign.id)).data).toEqual([]);
    expect((await member.from("announcement_export_choices").insert({ account_id: accountId, hotel_id: hotelId, event_id: id, importance: "High" })).error?.code).toBe("42501");
  });
  it("rejects a collection edit between selection and workbook commit", async () => {
    const id = await addEvent(); const request = input(id);
    await expect(createExport(request, { ...deps(id), build: async (rows) => {
      check(await db.from("events").update({ title: "Changed during generation" }).eq("id", id));
      return buildRevControlWorkbook(rows);
    } })).rejects.toMatchObject({ code: "P0001" });
    expect(check(await db.from("export_batches").select("id").eq("request_key", request.requestKey)).data).toEqual([]);
    expect(check(await db.from("hotel_event_exports").select("event_id").eq("hotel_id", hotelId).eq("event_id", id)).data).toEqual([]);
  });
  it("rejects an export when demand support disappears during workbook generation", async () => {
    const id = await addEvent(); const request = input(id);
    await expect(createExport(request, { ...deps(id), build: async (rows) => {
      check(await db.from("hotel_event_scores").update({ demand_assessment: null }).eq("event_id", id));
      return buildRevControlWorkbook(rows);
    } })).rejects.toMatchObject({ code: "P0001" });
    expect(check(await db.from("export_batches").select("id").eq("request_key", request.requestKey)).data).toEqual([]);
  });
  it("carries first-export claims through manual merges and confirmed source reassignment", async () => {
    const old = await addEvent(), target = await addEvent(), automatic = await addEvent();
    const batch = await createExport(input(old), deps(old));
    check(await member.from("account_events").update({ state: "excluded", merged_into_event_id: target }).eq("account_id", accountId).eq("event_id", old));
    expect(check(await db.from("hotel_event_exports").select("first_batch_id").eq("hotel_id", hotelId).eq("event_id", target).single()).data!.first_batch_id).toBe(batch);
    check(await db.from("event_sources").update({ event_id: automatic }).eq("provider_event_id", target));
    expect(check(await db.from("hotel_event_exports").select("first_batch_id").eq("hotel_id", hotelId).eq("event_id", automatic).single()).data!.first_batch_id).toBe(batch);
    const current = (await loadExportEvents(accountId, exportRange("2027-01-01", "2027-12-31"), [hotelId], true)).events;
    const history = await loadExportHistory(accountId, [hotelId], current);
    expect(history.find((entry) => entry.id === batch)!.items[0].snapshot?.eventId).toBe(automatic);
    check(await db.from("events").update({ source_state: "cancelled" }).eq("id", automatic));
    const changed = (await loadExportEvents(accountId, exportRange(null, null), [hotelId], true)).events;
    expect((await loadExportHistory(accountId, [hotelId], changed)).find((entry) => entry.id === batch)!.items[0]).toMatchObject({ latest: true, changed: true, eligible: false });
  });
  it("reads latest nested dashboard jobs and denies foreign account status with RLS", async () => {
    const area = check(await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single()).data!;
    const batchId = randomUUID();
    check(await db.from("collection_jobs").insert({ account_id: accountId, collection_area_id: area.id, batch_id: batchId, trigger: "manual", status: "queued" }));
    const status = await getCollectionStatus(accountId, area.id);
    expect(status.batch).toMatchObject({ batchId, active: true, total: 1 });
    expect(JSON.stringify(status).length).toBeLessThan(5000);
    expect((await getCollectionStatus(otherAccount, area.id)).batch).toBeNull();
    const dashboard = await getDashboardData(accountId);
    expect(dashboard.find(hotel => hotel.id === hotelId)?.status).toBe("running");
    const revision = status.revision;
    check(await db.from("collection_jobs").update({ attempts: 2 }).eq("batch_id", batchId));
    expect((await getCollectionStatus(accountId, area.id)).revision).toBe(revision);
    check(await db.from("collection_jobs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("batch_id", batchId));
  });
  it("applies manual dates before selecting export detail", async () => {
    const id = await addEvent();
    check(await db.from("account_events").update({ override_start_at: "2028-01-01T12:00:00Z", override_end_at: "2028-01-01T20:00:00Z" }).eq("account_id", accountId).eq("event_id", id));
    expect((await loadExportEvents(accountId, { start: "2027-01-01", end: "2027-12-31" }, [hotelId])).events.some(event => event.id === id)).toBe(false);
    expect((await loadExportEvents(accountId, { start: "2028-01-01", end: "2028-01-02" }, [hotelId])).events.some(event => event.id === id)).toBe(true);
  });

  it("projects research status without transferring saved research documents", async () => {
    const key = randomUUID(); marketKeys.push(key);
    check(await db.from("long_range_markets").insert({ market_key: key, state: { publishedAt: "2026-09-09T12:00:00Z", publicationPending: true, research: { requestedAt: "2026-09-09T11:00:00Z", usage: { large: 100 } }, pageCache: { large: "x".repeat(100_000) } } }));
    const status = await getMarketStatus(key);
    expect(status).toEqual({ publishedAt: "2026-09-09T12:00:00Z", publicationPending: true, research: { requestedAt: "2026-09-09T11:00:00Z" } });
    expect(JSON.stringify(status).length).toBeLessThan(200);
  });

  it("keeps run summaries small and exhausts usage rows only in run details", async () => {
    const area = check(await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single()).data!;
    const previousSuccess = new Date(Date.now() - 60_000).toISOString();
    check(await db.from("collection_runs").insert({ account_id: accountId, collection_area_id: area.id, trigger: "manual", started_at: previousSuccess, finished_at: previousSuccess, source_results: { claude: { state: "success" } } }));
    const runId = randomUUID();
    check(await db.from("collection_runs").insert({ id: runId, account_id: accountId, collection_area_id: area.id, trigger: "manual", finished_at: new Date().toISOString(), source_results: { claude: { state: "partial", funnel: { drops: [{ title: "A detailed rejection", stage: "verification", reason: "x".repeat(10_000) }] } } } }));
    check(await db.from("collection_usage_events").insert(Array.from({ length: 1001 }, () => ({ collection_run_id: runId, source: "claude", phase: "verify", model: "fixture", input_tokens: 1 }))));
    const summary = (await getSourceHealthSummaries()).find(run => run.id === runId)!;
    expect(summary.label).toBe("Deels voltooid");
    expect(JSON.stringify(summary).length).toBeLessThan(1000);
    expect(JSON.stringify(summary)).not.toContain("A detailed rejection");
    const [detail] = await getSourceHealthRuns(0, runId);
    expect(detail.sources.find(source => source.name === "claude")).toMatchObject({ usageCalls: 1001, inputTokens: 1001 });
    expect(Date.parse(detail.sources.find(source => source.name === "claude")!.lastSuccess!)).toBe(Date.parse(previousSuccess));
  });

});
