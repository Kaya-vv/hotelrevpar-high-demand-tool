import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { load } from "cheerio";

export type OfficialPage = { url: string; text: string; links: { url: string; label: string }[] };
export type PageFetcher = (url: string) => Promise<OfficialPage>;
const maxBytes = 2_000_000;

export function publicIPv4(address: string) {
  const [a, b, c] = address.split(".").map(Number);
  return address.split(".").length === 4 && a > 0 && a < 224 && a !== 10 && a !== 127
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}

export function officialHost(url: string, root: string) {
  const host = new URL(root).hostname.replace(/^www\./, "");
  const target = new URL(url);
  return /^https?:$/.test(target.protocol) && !target.username && !target.password && !target.port
    && (target.hostname.replace(/^www\./, "") === host || target.hostname.endsWith(`.${host}`));
}

export function parseOfficialPage(html: string, url: string): OfficialPage {
  const $ = load(html);
  $("script,style,noscript,svg").remove();
  const links = new Map<string, string>();
  $("a[href]").each((_index, anchor) => {
    try {
      const target = new URL($(anchor).attr("href")!, url);
      target.hash = "";
      if (officialHost(target.href, url) && target.href !== url) links.set(target.href, $(anchor).text().trim());
    } catch { /* Ignore malformed links rather than constructing paths. */ }
  });
  $("p,div,section,li,h1,h2,h3,tr,br").append("\n");
  return { url, text: $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim().slice(0, 36_000),
    links: [...links].map(([url, label]) => ({ url, label })) };
}

/** Fetch public HTML only. DNS is validated and pinned so untrusted URLs cannot reach internal services. */
export const fetchOfficialPage: PageFetcher = async (initial) => {
  let current = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(current);
    if (!officialHost(current, initial)) throw new Error("Official fetch refused URL or cross-site redirect");
    const addresses = await lookup(url.hostname, { family: 4, all: true });
    if (!addresses.length || addresses.some((entry) => !publicIPv4(entry.address))) throw new Error("Official fetch refused non-public address");
    const result = await new Promise<{ html?: string; redirect?: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        headers: { "user-agent": "DemandRadar/1.0 (official event date verification)", accept: "text/html" },
        lookup: (_host, _options, callback) => {
          if (_options.all) callback(null, [{ address: addresses[0].address, family: 4 }]);
          else callback(null, addresses[0].address, 4);
        },
      }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
          response.resume(); resolve({ redirect: new URL(response.headers.location, current).href }); return;
        }
        if (response.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/.test(response.headers["content-type"] ?? "")) {
          response.resume(); reject(new Error(`Official fetch returned HTTP ${response.statusCode} or non-HTML content`)); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) response.destroy(new Error("Official page exceeded 2 MB"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      });
      const timer = setTimeout(() => request.destroy(new Error("Official page timed out")), 20_000);
      request.on("close", () => clearTimeout(timer));
      request.on("error", reject);
      request.end();
    });
    if (result.redirect) { current = result.redirect; continue; }
    return parseOfficialPage(result.html!, current);
  }
  throw new Error("Official page redirected too many times");
};

export function announcementLink(page: OfficialPage, year: string) {
  const score = (link: OfficialPage["links"][number]) => {
    const text = `${link.url} ${link.label}`.toLowerCase();
    return (text.includes(year) ? 30 : 0)
      + (/future|upcoming|volgende|toekomst|save.the.date/.test(text) ? 20 : 0)
      + (/(?:^|[\s/_-])(?:about|over|prakti\w*|info\w*|dates|data)(?:$|[\s/_-])/.test(text) ? 10 : 0)
      + (/calendar|kalender|agenda|programma/.test(text) ? 5 : 0)
      - (/privacy|cookie|terms|ticket|login|contact/.test(text) ? 100 : 0)
      + (new URL(link.url).pathname.split("/")[1] === new URL(page.url).pathname.split("/")[1] ? 1 : 0);
  };
  return page.links.filter((link) => score(link) >= 5).sort((a, b) => score(b) - score(a))[0]?.url;
}

export async function retrieveOfficialPages(url: string, year: string, fetchPage: PageFetcher): Promise<{ pages: OfficialPage[]; errors: string[] }> {
  const first = await fetchPage(url);
  const pages = [first];
  const secondUrl = announcementLink(first, year);
  const errors: string[] = [];
  if (secondUrl) {
    try { pages.push(await fetchPage(secondUrl)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { pages, errors };
}
