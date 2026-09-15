import { eventLocalDate } from "@/features/events/normalize";

import type { NotificationEvent, NotificationHotel } from "./query";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dutchDate(value: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${eventLocalDate(value)}T12:00:00Z`));
}

function eventDate(event: NotificationEvent) {
  const start = dutchDate(event.startAt);
  const end = dutchDate(event.endAt);
  return start === end ? start : `${start} tot ${end}`;
}

export function renderEventNotification(
  hotel: NotificationHotel,
  events: NotificationEvent[],
  siteUrl: string,
) {
  const count = events.length;
  const eventWord = count === 1 ? "nieuw event" : "nieuwe events";
  const subject = `${count} ${eventWord} voor ${hotel.name}`;
  const baseUrl = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;
  const calendarUrl = new URL(
    `/open-calendar/${encodeURIComponent(hotel.id)}`,
    baseUrl,
  ).toString();
  const accountUrl = new URL("/account", baseUrl).toString();
  const rows = events
    .map(
      (event) => `<tr>
        <td style="padding:18px 0;border-top:1px solid #e5e7eb;font-size:15px;line-height:1.6;color:#1f2933">
          <strong style="font-size:16px;color:#0f172a">${escapeHtml(event.title)}</strong><br>
          ${escapeHtml(eventDate(event))}<br>
          Locatie: ${escapeHtml(event.venue ?? "nog niet bekend")}<br>
          <strong style="color:#f26522">${escapeHtml(event.level)}</strong>
        </td>
      </tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="nl">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${count} ${eventWord} voor ${escapeHtml(hotel.name)}.</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f6f8;padding:32px 16px">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden">
          <tr><td style="padding:32px 36px 24px 36px">
            <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;color:#0f172a">${count} ${eventWord} voor ${escapeHtml(hotel.name)}</h1>
            <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6">${count === 1 ? "Er is een nieuw event" : `Er zijn ${count} nieuwe events`} toegevoegd aan uw kalender.</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>
            <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0">
              <tr><td align="left">
                <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(calendarUrl)}" style="height:48px;v-text-anchor:middle;width:220px" arcsize="12%" stroke="f" fillcolor="#f26522"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold">Bekijk de kalender</center></v:roundrect><![endif]-->
                <!--[if !mso]><!--><a href="${escapeHtml(calendarUrl)}" style="background:#f26522;border-radius:6px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:220px">Bekijk de kalender</a><!--<![endif]-->
              </td></tr>
            </table>
            <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:#52616b">U kunt deze meldingen <a href="${escapeHtml(accountUrl)}" style="color:#0f766e">uitzetten bij Account</a>.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0">
            <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6">Met vriendelijke groet – With kind regards,</p>
            <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6"><strong>Robert van Vliet</strong><br>Revenue Consultant</p>
            <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#374151">Kerklaan 11<br>1427 AA | Amstelhoek<br>the Netherlands</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#374151">mob. <a href="tel:+31630098288" style="color:#0f766e;text-decoration:none">+31 (0) 630098288</a><br><a href="https://www.hotelrevpar.nl/" style="color:#0f766e">www.hotelrevpar.nl</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = [
    `${count} ${eventWord} voor ${hotel.name}`,
    "",
    ...events.flatMap((event) => [
      event.title,
      eventDate(event),
      `Locatie: ${event.venue ?? "nog niet bekend"}`,
      event.level,
      "",
    ]),
    `Bekijk de kalender: ${calendarUrl}`,
    `Meldingen uitzetten: ${accountUrl}`,
    "",
    "Met vriendelijke groet – With kind regards,",
    "Robert van Vliet",
    "Revenue Consultant",
    "+31 (0) 630098288",
    "www.hotelrevpar.nl",
  ].join("\n");
  return { subject, html, text };
}
