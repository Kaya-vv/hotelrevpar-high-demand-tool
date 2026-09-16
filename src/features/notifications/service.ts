import { randomUUID } from "node:crypto";

import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

import { renderEventNotification } from "./email";
import {
  loadVisibleNotificationEvents,
  type NotificationEvent,
} from "./query";

const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function notificationRetryExpired(
  firstAttemptAt: string | null,
  now: Date,
) {
  return Boolean(
    firstAttemptAt &&
      now.getTime() - Date.parse(firstAttemptAt) >= RETRY_WINDOW_MS,
  );
}

export async function postEventNotification(
  input: {
    id: string;
    recipientEmail: string;
    subject: string;
    html: string;
    text: string;
  },
  config: { apiKey: string; from: string; replyTo?: string },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `demandradar/event-notification/${input.id}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.recipientEmail],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    return {
      accepted: false as const,
      status: response.status,
      retryable:
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500,
    };
  }
  const result = (await response.json().catch(() => ({}))) as { id?: string };
  return { accepted: true as const, providerMessageId: result.id ?? null };
}

function notificationsEnabled() {
  return process.env.EVENT_NOTIFICATIONS_ENABLED === "enabled";
}

async function hotelForArea(
  admin: AdminClient,
  accountId: string,
  areaId: string,
) {
  const { data, error } = await admin
    .from("collection_areas")
    .select("hotel_id")
    .eq("account_id", accountId)
    .eq("id", areaId)
    .maybeSingle();
  if (error) throw error;
  return data?.hotel_id ?? null;
}

async function prepareNotificationBatch(
  admin: AdminClient,
  batchId: string,
  now = new Date(),
) {
  const { data: batch, error: batchError } = await admin
    .from("event_notification_batches")
    .select("id, account_id, hotel_id, user_id, status")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch || batch.status !== "preparing") return batch?.status ?? null;

  const { data: member, error: memberError } = await admin
    .from("account_members")
    .select("event_notifications_enabled")
    .eq("account_id", batch.account_id)
    .eq("user_id", batch.user_id)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member?.event_notifications_enabled) {
    await cancelNotificationBatch(admin, batch.id, true);
    return "cancelled";
  }

  const [{ data: items, error: itemError }, hotel] = await Promise.all([
    admin
      .from("event_notification_items")
      .select("event_id")
      .eq("batch_id", batch.id),
    loadVisibleNotificationEvents(
      admin,
      batch.account_id,
      batch.hotel_id,
      now,
    ),
  ]);
  if (itemError) throw itemError;
  if (!hotel) {
    await cancelNotificationBatch(admin, batch.id, true);
    return "cancelled";
  }
  const visible = new Map(hotel.events.map((event) => [event.id, event]));
  const included = items.flatMap((item) => {
    const event = visible.get(item.event_id);
    return event ? [event] : [];
  });
  const hiddenIds = items
    .filter((item) => !visible.has(item.event_id))
    .map((item) => item.event_id);
  if (hiddenIds.length) {
    const { error } = await admin
      .from("event_notification_items")
      .update({ batch_id: null, suppressed: true })
      .eq("batch_id", batch.id)
      .in("event_id", hiddenIds);
    if (error) throw error;
  }
  if (!included.length) {
    await cancelNotificationBatch(admin, batch.id);
    return "cancelled";
  }

  const { data: user, error: userError } = await admin.auth.admin.getUserById(
    batch.user_id,
  );
  if (userError) throw userError;
  if (!user.user.email) {
    const { error } = await admin
      .from("event_notification_batches")
      .update({ status: "failed", error_code: "recipient_missing" })
      .eq("id", batch.id);
    if (error) throw error;
    return "failed";
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL ontbreekt.");
  const message = renderEventNotification(hotel, included, siteUrl);
  const { error: updateError } = await admin
    .from("event_notification_batches")
    .update({
      recipient_email: user.user.email,
      subject: message.subject,
      html_body: message.html,
      text_body: message.text,
      status: "pending",
      error_code: null,
    })
    .eq("id", batch.id)
    .eq("status", "preparing");
  if (updateError) throw updateError;
  return "pending";
}

async function cancelNotificationBatch(
  admin: AdminClient,
  batchId: string,
  suppressItems = false,
) {
  const { error: itemError } = await admin
    .from("event_notification_items")
    .update({ batch_id: null, ...(suppressItems ? { suppressed: true } : {}) })
    .eq("batch_id", batchId);
  if (itemError) throw itemError;
  const { error: batchError } = await admin
    .from("event_notification_batches")
    .update({ status: "cancelled" })
    .eq("id", batchId);
  if (batchError) throw batchError;
}

async function publishPreparedBatch(batchId: string) {
  try {
    const { publishCollectionJob } = await import("@/features/collection/jobs");
    await publishCollectionJob({ kind: "event-notification", batchId });
    return true;
  } catch (error) {
    console.error("Event notification could not be queued", {
      batchId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

async function reserveForMember(
  admin: AdminClient,
  accountId: string,
  userId: string,
  enabled: boolean,
  hotelId: string,
  events: NotificationEvent[],
  now = new Date(),
) {
  const eventIds = events.map((event) => event.id);
  const existing = await fetchInBatches(eventIds, (ids) =>
    admin
      .from("event_notification_items")
      .select("event_id, batch_id, suppressed")
      .eq("user_id", userId)
      .eq("hotel_id", hotelId)
      .in("event_id", ids),
  );
  const known = new Set(existing.map((item) => item.event_id));
  const fresh = eventIds.filter((eventId) => !known.has(eventId));
  // A previous attempt may have recorded items before creating or claiming its batch.
  const unclaimed = existing.some((item) => !item.batch_id && !item.suppressed);
  if (!fresh.length && !unclaimed) return null;
  if (fresh.length) {
    const { error: insertError } = await admin
      .from("event_notification_items")
      .upsert(
        fresh.map((eventId) => ({
          account_id: accountId,
          hotel_id: hotelId,
          event_id: eventId,
          user_id: userId,
          suppressed: !enabled,
          created_at: now.toISOString(),
        })),
        { onConflict: "user_id,hotel_id,event_id", ignoreDuplicates: true },
      );
    if (insertError) throw insertError;
  }
  if (!enabled) return null;

  const batchId = randomUUID();
  const { error: batchError } = await admin
    .from("event_notification_batches")
    .insert({ id: batchId, account_id: accountId, hotel_id: hotelId, user_id: userId });
  if (batchError) throw batchError;
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_event_notification_items",
    { p_account: accountId, p_hotel: hotelId, p_user: userId, p_batch: batchId },
  );
  if (claimError) throw claimError;
  if (!claimed.length) {
    await cancelNotificationBatch(admin, batchId);
    return null;
  }
  const status = await prepareNotificationBatch(admin, batchId, now);
  return status === "pending" ? batchId : null;
}

async function upsertKnownItems(
  admin: AdminClient,
  rows: Array<{
    account_id: string;
    hotel_id: string;
    event_id: string;
    user_id: string;
    suppressed: boolean;
  }>,
) {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin
      .from("event_notification_items")
      .upsert(rows.slice(index, index + 200), {
        onConflict: "user_id,hotel_id,event_id",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
}

export async function stageHotelEventNotifications(
  accountId: string,
  areaId: string,
  now = new Date(),
) {
  if (!notificationsEnabled()) return { queued: 0 };
  const admin = createAdminClient();
  const hotelId = await hotelForArea(admin, accountId, areaId);
  if (!hotelId) return { queued: 0 };
  const hotel = await loadVisibleNotificationEvents(admin, accountId, hotelId, now);
  if (!hotel?.events.length) return { queued: 0 };
  const { data: members, error: memberError } = await admin
    .from("account_members")
    .select("user_id, event_notifications_enabled")
    .eq("account_id", accountId);
  if (memberError) throw memberError;

  let queued = 0;
  for (const member of members) {
    const batchId = await reserveForMember(
      admin,
      accountId,
      member.user_id,
      member.event_notifications_enabled,
      hotel.id,
      hotel.events,
      now,
    );
    if (batchId && (await publishPreparedBatch(batchId))) queued += 1;
  }
  return { queued };
}

export async function baselineMemberNotifications(
  accountId: string,
  userId: string,
  admin = createAdminClient(),
  now = new Date(),
) {
  const { data: hotels, error: hotelError } = await admin
    .from("hotels")
    .select("id")
    .eq("account_id", accountId);
  if (hotelError) throw hotelError;
  let recorded = 0;
  for (const { id: hotelId } of hotels) {
    const hotel = await loadVisibleNotificationEvents(admin, accountId, hotelId, now);
    if (!hotel?.events.length) continue;
    await upsertKnownItems(
      admin,
      hotel.events.map((event) => ({
        account_id: accountId,
        hotel_id: hotelId,
        event_id: event.id,
        user_id: userId,
        suppressed: true,
      })),
    );
    recorded += hotel.events.length;
  }
  return recorded;
}

export async function disableMemberNotifications(
  accountId: string,
  userId: string,
  admin = createAdminClient(),
) {
  const { error } = await admin
    .from("event_notification_batches")
    .update({ status: "cancelled" })
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .in("status", ["preparing", "pending"]);
  if (error) throw error;
  const { error: itemError } = await admin
    .from("event_notification_items")
    .update({ batch_id: null, suppressed: true })
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (itemError) throw itemError;
  await baselineMemberNotifications(accountId, userId, admin);
}

export async function baselineAllEventNotifications(input: {
  apply: boolean;
  admin?: AdminClient;
  now?: Date;
}) {
  const admin = input.admin ?? createAdminClient();
  const now = input.now ?? new Date();
  const [{ data: members, error: memberError }, { data: hotels, error: hotelError }] =
    await Promise.all([
      admin.from("account_members").select("account_id, user_id"),
      admin.from("hotels").select("id, account_id"),
    ]);
  if (memberError) throw memberError;
  if (hotelError) throw hotelError;
  let visiblePairs = 0;
  let recorded = 0;
  const visibleByHotel = new Map<string, NotificationEvent[]>();
  for (const hotelRow of hotels) {
    const hotel = await loadVisibleNotificationEvents(
      admin,
      hotelRow.account_id,
      hotelRow.id,
      now,
    );
    if (!hotel?.events.length) continue;
    visibleByHotel.set(hotelRow.id, hotel.events);
    const accountMembers = members.filter(
      (member) => member.account_id === hotelRow.account_id,
    );
    visiblePairs += hotel.events.length * accountMembers.length;
  }
  if (input.apply) for (const member of members) {
    const rows = hotels
      .filter((hotel) => hotel.account_id === member.account_id)
      .flatMap((hotel) => (visibleByHotel.get(hotel.id) ?? []).map((event) => ({
        account_id: member.account_id,
        hotel_id: hotel.id,
        event_id: event.id,
        user_id: member.user_id,
        suppressed: true,
      })));
    if (!rows.length) continue;
    await upsertKnownItems(admin, rows);
    recorded += rows.length;
  }
  return { hotels: hotels.length, members: members.length, visiblePairs, recorded };
}

export async function enqueuePendingEventNotifications() {
  if (!notificationsEnabled()) return { queued: 0 };
  const admin = createAdminClient();
  // Recover items even when no further new event arrives to prompt another staging attempt.
  const orphans = await fetchAllRows((from, to) => admin
    .from("event_notification_items")
    .select("account_id, hotel_id, user_id, event_id")
    .is("batch_id", null)
    .eq("suppressed", false)
    .order("user_id").order("hotel_id").order("event_id")
    .range(from, to));
  const hotels = new Map(orphans.map((item) => [item.hotel_id, item.account_id]));
  let queued = 0;
  const { data: batches, error } = await admin
    .from("event_notification_batches")
    .select("id, status")
    .in("status", ["preparing", "pending"])
    .order("created_at")
    .limit(100);
  if (error) throw error;
  for (const batch of batches) {
    const status =
      batch.status === "preparing"
        ? await prepareNotificationBatch(admin, batch.id)
        : batch.status;
    if (status === "pending" && (await publishPreparedBatch(batch.id))) queued += 1;
  }
  for (const [hotelId, accountId] of hotels) {
    const { data: area, error: areaError } = await admin.from("collection_areas")
      .select("id").eq("account_id", accountId).eq("hotel_id", hotelId).maybeSingle();
    if (areaError) throw areaError;
    if (area) queued += (await stageHotelEventNotifications(accountId, area.id)).queued;
  }
  return { queued };
}

export async function sendEventNotification(
  batchId: string,
  fetcher: typeof fetch = fetch,
  now = new Date(),
  admin = createAdminClient(),
) {
  if (!notificationsEnabled()) return;
  await prepareNotificationBatch(admin, batchId, now);
  const { data: batch, error: batchError } = await admin
    .from("event_notification_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch || !["pending", "sending"].includes(batch.status)) return;

  const { data: member, error: memberError } = await admin
    .from("account_members")
    .select("event_notifications_enabled")
    .eq("account_id", batch.account_id)
    .eq("user_id", batch.user_id)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member?.event_notifications_enabled) {
    await cancelNotificationBatch(admin, batch.id, true);
    return;
  }
  const { data: hotel, error: hotelError } = await admin.from("hotels")
    .select("id").eq("account_id", batch.account_id).eq("id", batch.hotel_id)
    .is("archived_at", null).maybeSingle();
  if (hotelError) throw hotelError;
  if (!hotel) {
    await cancelNotificationBatch(admin, batch.id, true);
    return;
  }
  if (notificationRetryExpired(batch.first_attempt_at, now)) {
    const { error } = await admin
      .from("event_notification_batches")
      .update({ status: "uncertain", error_code: "retry_window_expired" })
      .eq("id", batch.id);
    if (error) throw error;
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Resend is niet geconfigureerd.");
  const attemptAt = now.toISOString();
  const { error: attemptError } = await admin
    .from("event_notification_batches")
    .update({
      status: "sending",
      attempt_count: batch.attempt_count + 1,
      first_attempt_at: batch.first_attempt_at ?? attemptAt,
      last_attempt_at: attemptAt,
      error_code: null,
    })
    .eq("id", batch.id);
  if (attemptError) throw attemptError;

  let result: Awaited<ReturnType<typeof postEventNotification>>;
  try {
    result = await postEventNotification(
      {
        id: batch.id,
        recipientEmail: batch.recipient_email!,
        subject: batch.subject!,
        html: batch.html_body!,
        text: batch.text_body!,
      },
      {
        apiKey,
        from,
        ...(process.env.RESEND_REPLY_TO_EMAIL
          ? { replyTo: process.env.RESEND_REPLY_TO_EMAIL }
          : {}),
      },
      fetcher,
    );
  } catch (error) {
    const { error: updateError } = await admin
      .from("event_notification_batches")
      .update({ error_code: "network_error" })
      .eq("id", batch.id);
    if (updateError) throw updateError;
    throw error;
  }

  if (!result.accepted) {
    const { error } = await admin
      .from("event_notification_batches")
      .update({
        status: result.retryable ? "sending" : "failed",
        error_code: `resend_${result.status}`,
      })
      .eq("id", batch.id);
    if (error) throw error;
    if (result.retryable) throw new Error(`Resend temporary error ${result.status}`);
    return;
  }

  const { error: sentError } = await admin
    .from("event_notification_batches")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: result.providerMessageId,
      error_code: null,
    })
    .eq("id", batch.id);
  if (sentError) throw sentError;
}
