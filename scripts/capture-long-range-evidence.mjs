// Independent evidence capture. No credentials, model calls or production writes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "vite";

const benchmark = JSON.parse(await readFile("tests/fixtures/long-range-benchmark.json", "utf8"));
const urls = [...new Set([...benchmark.markets.flatMap((market) => market.events.flatMap((event) => [event.officialUrl, ...(event.demandUrls ?? [])])), ...benchmark.negativeCases.map((item) => item.url)])];
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
await mkdir("refs/long-range-evidence", { recursive: true });
try {
  const { parseOfficialPage } = await server.ssrLoadModule("/src/features/collection/official-pages.ts");
  if (process.argv.includes("--reparse")) {
    const recording = JSON.parse(await readFile("tests/fixtures/long-range-pages.json", "utf8"));
    for (const result of recording.results) if (result.hash && result.page) {
      const html = await readFile(`refs/long-range-evidence/${result.hash}.html`, "utf8");
      result.page = parseOfficialPage(html, result.page.url);
    }
    await writeFile("tests/fixtures/long-range-pages.json", JSON.stringify(recording, null, 2));
  } else {
  const previous = process.argv.includes("--append") ? JSON.parse(await readFile("tests/fixtures/long-range-pages.json", "utf8")) : null;
  const results = previous?.results ?? [];
  const pendingUrls = urls.filter((url) => !results.some((result) => result.requestedUrl === url));
  for (let offset = 0; offset < pendingUrls.length; offset += 4) {
    results.push(...await Promise.all(pendingUrls.slice(offset, offset + 4).map(async (url) => {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
        const html = await response.text();
        const hash = createHash("sha256").update(html).digest("hex");
        await writeFile(`refs/long-range-evidence/${hash}.html`, html);
        const page = parseOfficialPage(html, response.url);
        console.log(`${response.status}: ${url}`);
        return { requestedUrl: url, checkedAt, status: response.status, hash, page };
      } catch (error) { console.log(`Unavailable: ${url}`); return { requestedUrl: url, checkedAt, error: error.message }; }
    })));
  }
  await writeFile("tests/fixtures/long-range-pages.json", JSON.stringify({ capturedAt: new Date().toISOString(), provenance: "Real HTTP responses, no model or synthetic content. Raw HTML in ignored refs/long-range-evidence keyed by SHA256. Failed fetches remain in the benchmark.", results }, null, 2));
  }
} finally { await server.close(); }
