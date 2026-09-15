// Sends one real email with existing calendar data. It does not run event discovery,
// change the notification outbox, or mark any event as newly found.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const envFile = existsSync(".env.production.local")
  ? ".env.production.local"
  : ".env.local";
process.loadEnvFile(envFile);

const required = [
  "NEXT_PUBLIC_SITE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_TEST_EMAIL",
  "NOTIFICATION_TEST_HOTEL_ID",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Ontbrekende testinstellingen: ${missing.join(", ")}`);
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
  const [{ createAdminClient }, { loadVisibleNotificationEvents }, { renderEventNotification }, { postEventNotification }] =
    await Promise.all([
      server.ssrLoadModule("/src/lib/supabase/admin.ts"),
      server.ssrLoadModule("/src/features/notifications/query.ts"),
      server.ssrLoadModule("/src/features/notifications/email.ts"),
      server.ssrLoadModule("/src/features/notifications/service.ts"),
    ]);
  const admin = createAdminClient();
  const { data: hotelRow, error } = await admin
    .from("hotels")
    .select("id, account_id")
    .eq("id", process.env.NOTIFICATION_TEST_HOTEL_ID)
    .maybeSingle();
  if (error) throw error;
  if (!hotelRow) throw new Error("Het testhotel bestaat niet.");

  const hotel = await loadVisibleNotificationEvents(
    admin,
    hotelRow.account_id,
    hotelRow.id,
  );
  const events = hotel?.events.slice(0, 3) ?? [];
  if (!hotel || !events.length) {
    throw new Error("Dit hotel heeft geen zichtbare events voor een testmail.");
  }
  const message = renderEventNotification(
    { ...hotel, events },
    events,
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  const result = await postEventNotification(
    {
      id: randomUUID(),
      recipientEmail: process.env.RESEND_TEST_EMAIL,
      subject: `[TEST] ${message.subject}`,
      html: message.html,
      text: message.text,
    },
    {
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
      ...(process.env.RESEND_REPLY_TO_EMAIL
        ? { replyTo: process.env.RESEND_REPLY_TO_EMAIL }
        : {}),
    },
  );
  if (!result.accepted) {
    throw new Error(`Resend weigerde de testmail met status ${result.status}.`);
  }
  console.log("Testmail geaccepteerd door Resend. Controleer nu de ingestelde inbox.");
} finally {
  await server.close();
}
