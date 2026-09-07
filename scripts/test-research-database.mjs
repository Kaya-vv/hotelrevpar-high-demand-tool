import { execSync, spawnSync } from "node:child_process";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const status = JSON.parse(execSync(`${npx} supabase status --workdir refs/research-db -o json`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (status.API_URL !== "http://127.0.0.1:54421") throw new Error("Integration tests require the isolated local Supabase instance");
const target = process.env.RESEARCH_REPAIR_RESULT ? "src/features/collection/research-outcome-database.test.ts" : "src/features/collection/research-database.test.ts src/features/collection/research-outcome-database.test.ts";
const result = spawnSync(`${npx} vitest run ${target} --no-file-parallelism`, { shell: true, stdio: "inherit", env: { ...process.env, RESEARCH_LOCAL_KEY: status.SERVICE_ROLE_KEY } });
process.exitCode = result.status ?? 1;
