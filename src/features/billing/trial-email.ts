import { eventLocalDate } from "@/features/events/normalize";

// Markup and signature copied from the event e-mail on purpose: that e-mail is in production and
// a shared layout would put it at risk for no gain here.

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

export function renderTrialReminder(input: {
  accountName: string;
  endsAt: string;
  siteUrl: string;
  checkoutUrl: string | null;
}): { subject: string; html: string; text: string } {
  const date = dutchDate(input.endsAt);
  const subject = `Je proefperiode stopt op ${date}`;
  const baseUrl = /^https?:\/\//i.test(input.siteUrl) ? input.siteUrl : `https://${input.siteUrl}`;
  const calendarUrl = new URL("/calendar", baseUrl).toString();
  const stops = `Je gratis maand DemandRadar stopt op ${date}. Daarna kun je niet meer inloggen en zoeken we geen nieuwe events meer voor ${input.accountName}.`;
  const keeps = "Met een abonnement blijft alles staan wat je nu hebt, mag je meer hotels toevoegen en zie je ook events die verder dan 90 dagen vooruit liggen.";
  const noCheckout = "Bel of mail Robert om je abonnement te starten.";
  const action = input.checkoutUrl
    ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0">
              <tr><td align="left">
                <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(input.checkoutUrl)}" style="height:48px;v-text-anchor:middle;width:220px" arcsize="12%" stroke="f" fillcolor="#f26522"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold">Abonnement afsluiten</center></v:roundrect><![endif]-->
                <!--[if !mso]><!--><a href="${escapeHtml(input.checkoutUrl)}" style="background:#f26522;border-radius:6px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:220px">Abonnement afsluiten</a><!--<![endif]-->
              </td></tr>
            </table>`
    : `<p style="margin:0 0 20px 0;font-size:16px;line-height:1.6"><strong>${noCheckout}</strong></p>`;
  const html = `<!doctype html>
<html lang="nl">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(subject)}.</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f6f8;padding:32px 16px">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden">
          <tr><td style="padding:32px 36px 24px 36px">
            <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;color:#0f172a">Nog een week proefperiode</h1>
            <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6">${escapeHtml(stops)}</p>
            <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6">${escapeHtml(keeps)}</p>
            ${action}
            <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:#52616b">Je overzicht staat hier: <a href="${escapeHtml(calendarUrl)}" style="color:#0f766e">${escapeHtml(calendarUrl)}</a></p>
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
    "Nog een week proefperiode",
    "",
    stops,
    "",
    keeps,
    "",
    input.checkoutUrl ? `Abonnement afsluiten: ${input.checkoutUrl}` : noCheckout,
    `Je overzicht staat hier: ${calendarUrl}`,
    "",
    "Met vriendelijke groet – With kind regards,",
    "Robert van Vliet",
    "Revenue Consultant",
    "+31 (0) 630098288",
    "www.hotelrevpar.nl",
  ].join("\n");
  return { subject, html, text };
}
