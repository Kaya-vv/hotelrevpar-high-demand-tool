// Lists events that a hotel calendar shows more than once and which row would be kept.
// Read-only by default; `--apply` hides the copies now instead of waiting for the next hotel run.
// Usage: node scripts/merge-calendar-copies.mjs [--apply]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
Object.assign(process.env, env);
const apply = process.argv.includes("--apply");

const server = await createServer({
  configFile: false, logLevel: "error",
  resolve: { alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-stub.mjs") } },
  server: { middlewareMode: true, hmr: false },
});
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { findCalendarCopies, mergeCalendarCopies } = await server.ssrLoadModule("/src/features/collection/calendar-copies.ts");
const { demandLevels } = await server.ssrLoadModule("/src/features/events/importance.ts");

const { data: accounts, error } = await admin.from("accounts").select("id, name").order("name");
if (error) throw error;
let total = 0;
for (const account of accounts) {
  const groups = await findCalendarCopies(admin, account.id);
  if (!groups.length) continue;
  console.log(`\n== ${account.name}`);
  for (const group of groups) {
    for (const event of group.events) {
      const role = group.skipped ? "  ?" : event.id === group.keeperId ? "keep" : "hide";
      const levels = [...event.levels.values()].map((rank) => demandLevels[rank] ?? "-").join("/");
      console.log(`  ${role.padEnd(4)} ${event.title} | ${event.startDate}${event.endDate === event.startDate ? "" : ` → ${event.endDate}`} | ${levels}${event.manual ? " | handmatig" : ""}`);
    }
    if (group.skipped) console.log(`       niet samengevoegd: ${group.skipped}`);
    else total += group.events.length - 1;
    console.log("");
  }
  if (apply) console.log(`  merged: ${(await mergeCalendarCopies(admin, account.id)).merged}`);
}
console.log(`${apply ? "Hidden" : "Would hide"} ${total} copies.`);
await server.close();
