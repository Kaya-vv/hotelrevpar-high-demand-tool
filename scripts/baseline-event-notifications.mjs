// Records the calendar that recipients already know before email notifications are enabled.
// Dry run: pnpm notifications:baseline
// Apply:   pnpm notifications:baseline -- --apply
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const envFile = existsSync(".env.production.local")
  ? ".env.production.local"
  : ".env.local";
process.loadEnvFile(envFile);

const apply = process.argv.includes("--apply");
if (apply && process.env.EVENT_NOTIFICATIONS_ENABLED === "enabled") {
  throw new Error("Zet EVENT_NOTIFICATIONS_ENABLED eerst op disabled.");
}

const server = await createServer({
  configFile: false,
  logLevel: "error",
  resolve: {
    alias: {
      "@": resolve("src"),
      "server-only": resolve("node_modules/server-only/empty.js"),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

try {
  const { baselineAllEventNotifications } = await server.ssrLoadModule(
    "/src/features/notifications/service.ts",
  );
  const result = await baselineAllEventNotifications({ apply });
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", ...result }, null, 2));
} finally {
  await server.close();
}
