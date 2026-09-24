/**
 * Ticket sellers publish add-ons as separate listings at the arena's own address: parking permits,
 * hospitality boxes, seat upgrades and dinner packages. They inherit the venue name but represent
 * no additional audience, so they must never borrow the venue's crowd. Measured against production
 * on 2026-09-10 these were 186 of 1,053 collected events, and two of them sat at the bare
 * `Ziggo Dome` string that a genuine arena show also uses - hence a title rule, not a venue rule.
 */
const addOnQualifier =
  /\|\s*[^|]*\b(premium|vip|comfort seats|wine\s*&\s*dine|vinyl room|sky ?lounge|skybox|hospitality|meet\s*&\s*greet|early entry)\b/i;
// `K_Parking Permit ...` is how Ahoy numbers its car parks, so this cannot anchor on a word start.
const parkingListing = /parking\s+(permit|pass)|parkeerkaart/i;
const ticketExcluded = /ticket(s)? not included/i;

export function isAncillaryListing(title: string, venue: string | null) {
  return addOnQualifier.test(title)
    || parkingListing.test(title)
    || ticketExcluded.test(title)
    || parkingListing.test(venue ?? "");
}

/**
 * Arena and stadium capacities, each verified against the operator's or Wikipedia's published
 * figure on 2026-09-10. Only the scorer's bands matter (15,000 / 5,000 / 2,000 / 500), so a
 * configuration-dependent venue is recorded at its regular seated capacity rather than its
 * maximum: the Johan Cruijff ArenA holds 71,000 for a centre-stage concert and De Kuip 50,000,
 * but both are already in the top band at their football figure.
 *
 * Exhibition and congress centres are deliberately absent. A hall's floor area is not an audience,
 * and those events already earn a graded assessment from their own attendance evidence.
 */
const venueCapacities: Record<string, number> = {
  "ziggo dome": 17_000,
  "johan cruijff arena": 55_865,
  "johan cruyff arena": 55_865,
  "amsterdam arena": 55_865,
  "afas live": 6_000,
  "rotterdam ahoy": 16_426,
  "ahoy arena": 16_426,
  "stadion feijenoord": 47_500,
  "de kuip": 47_500,
  "philips stadion": 35_000,
  "stadion galgenwaard": 23_750,
  gelredome: 34_000,
  euroborg: 22_550,
};

/**
 * A venue's capacity only stands in for a travelling audience when the event actually fills the
 * bowl. Two production cases forced this to be an allowlist rather than a category blocklist:
 * `DigiMarCon Amsterdam` and `TECHSPO` are congresses in the Johan Cruijff ArenA's business
 * centre, and its 55,865 seats are not their delegates; and an Eredivisie fixture there draws
 * local support, which is the audience the scorer's sports cap already discounts.
 *
 * Categories are free text from the model - production holds 123 distinct spellings, including
 * `sport`, `Football match` and `Voetbal (Eredivisie)` - so this admits only the performance
 * words. Anything unrecognised keeps the grade it already had.
 */
const performanceCategory = /music|muziek|concert|festival|dance|comedy|cabaret|\bdj\b/i;

export function venueCrowdIsAudience(category: string, title: string, venue: string | null) {
  return performanceCategory.test(category) && !isAncillaryListing(title, venue);
}

const normalize = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A trailing qualifier a venue's own name never needs. Stripping is attempted only after an exact
 * miss, which is what keeps `Ziggo Dome Club` and `AFAS Live Loge` - separate hospitality rooms
 * that seat a few dozen - from resolving to the arena beside them.
 */
const trailingQualifier =
  /\s+(stadium|stadion|amsterdam|rotterdam|utrecht|eindhoven|arnhem|groningen|nijmegen|tilburg|den haag)$/;

export function knownVenueCapacity(venue: string | null): number | null {
  if (!venue) return null;
  for (const segment of normalize(venue).split(",")) {
    let name = segment.trim();
    while (name) {
      const capacity = venueCapacities[name];
      if (capacity) return capacity;
      const stripped = name.replace(trailingQualifier, "");
      if (stripped === name) break;
      name = stripped;
    }
  }
  return null;
}

/** A stadium concert fills hotels on its own; a few a year, mostly acts that draw fans nationwide. */
export const STADIUM_CONCERT_CAPACITY = 30_000;
/** An arena has a show most nights, many with a local audience; the manager judges each one. */
export const ARENA_CONCERT_CAPACITY = 15_000;

/**
 * Concerts at the biggest venues, decided with the owner on 24 September 2026 after Oasis at the
 * Johan Cruijff ArenA stayed hidden: the ArenA agenda lists dates, never hotel stays, so no
 * evidence rule could ever lift it. Stadiums (Johan Cruijff ArenA, De Kuip, Philips Stadion,
 * GelreDome) grade High; arenas (Ziggo Dome, Ahoy, Galgenwaard, Euroborg) are shown for the
 * manager to grade. Football is excluded by `venueCrowdIsAudience`.
 */
export function bigVenueConcert(category: string, title: string, venue: string | null) {
  if (!venueCrowdIsAudience(category, title, venue)) return null;
  const capacity = knownVenueCapacity(venue);
  if (capacity === null || capacity < ARENA_CONCERT_CAPACITY) return null;
  return { tier: capacity >= STADIUM_CONCERT_CAPACITY ? "stadium" as const : "arena" as const, capacity };
}
