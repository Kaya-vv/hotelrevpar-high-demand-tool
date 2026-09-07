import { writeFile } from "node:fs/promises";
const results = await Promise.all(["Eindhoven", "Rotterdam", "Groningen", "Amsterdam"].map(async (city) => {
  const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
  url.search = new URLSearchParams({ q: city, fq: "type:woonplaats", rows: "10", fl: "woonplaatsnaam,centroide_ll" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${city}: HTTP ${response.status}`);
  return { city, url: url.href, checkedAt: new Date().toISOString(), body: await response.json() };
}));
await writeFile("tests/fixtures/long-range-locations.json", JSON.stringify({ provenance: "Actual public PDOK responses; no synthetic coordinates", results }, null, 2));
