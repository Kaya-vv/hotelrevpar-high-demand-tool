import { execSync, spawnSync } from "node:child_process";
console.log("Policy/persistence test with manually researched evidence. This is NOT a Refresh discovery acceptance test or production-readiness gate.");
const runner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const status = JSON.parse(execSync(`${runner} exec supabase status --workdir refs/research-db -o json`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (status.API_URL !== "http://127.0.0.1:54421") throw new Error("Replay requires isolated local Supabase");
const result = spawnSync(`${runner} exec vitest run src/features/collection/demand-replay-database.test.ts --no-file-parallelism`, {
  shell: true, stdio: "inherit", env: { ...process.env, RESEARCH_LOCAL_KEY: status.SERVICE_ROLE_KEY },
});
process.exitCode = result.status ?? 1;
