# Scoring rework: score hotel rooms, not crowd size

Date: 2026-10-12. Status: proposal, measured, not implemented.
Trigger: Novotel Rotterdam feedback, relayed by Robert: Breakbulk Europe (12,800 professionals from 134 countries, three days) scores 71/High, while Het Grote Bassie & Adriaan Concert scores 85/Peak.

## Why the scores are upside down today

- Any concert in a known arena takes the arena's full capacity as its audience. Ahoy holds 16,426, so a family show earns the maximum impact of 60 points. A two-day listing then counts as an overnight signal.
- A crowd figure only maps to one of four size bands. Breakbulk's 12,800 lands in the same band as a 5,000-person concert. Whether those people travel in and stay is never weighed.
- Champions League matches are Peak by a fixed rule, regardless of the hotel.
- Measured visitor figures are rare. Of 3,965 active event sources, 36 carry an attendance figure and 37 carry a quoted number. Another 53 events have a size-check visitor estimate. The AI size guess has only three values (35, 45 and 60 points).

## Options measured

`scripts/scoring-rework-preview.mjs` rescores every event of the 18 active hotels from stored production evidence. It is read-only and makes no provider calls. Run it with `node scripts/scoring-rework-preview.mjs [hotel]`; the full rows land in `out/scoring-rework-preview.json`.

Both options estimate **rooms per night** as visitors present per day × the share that stays overnight:

- **Visitors:** a measured figure first (attendance, a quoted number, or the size check's visitor estimate). Otherwise the larger of hall size × 0.8 and the AI size guess.
- **Staying share:**

  | Signal | Share |
  |---|---|
  | International audience | 0.5 |
  | National audience | 0.3 |
  | Regional audience | 0.08 |
  | Hotel-stay evidence | 0.4 |
  | Trade fair or championship evidence | 0.35 |
  | Business event | 0.3 |
  | Concert | 0.08 |
  | Show or family performance | 0.03 |
  | European football match | 0.06 |

- **Per-day visitors:** a congress has the same delegates every day; a trade fair partly; a festival mostly new visitors.

### A. Full model

Rooms per night replaces the impact points entirely. Peak needs a measured visitor figure.

### B. Targeted fixes on top of today's scorer (recommended)

1. Hall size alone gives at most High (84). A family show gets at most Medium (69).
2. A measured visitor figure with a travelling audience lifts the event:
   - from about 2,000 rooms per night to Peak, but only for multi-day runs, business events, championships and marathons;
   - from about 800 rooms per night to at least High.
3. Champions League matches become High (80) instead of an automatic Peak.

Every other score stays exactly as it is today.

## Before and after (unique events, all active hotels)

| | Today | A. Full model | B. Targeted |
|---|---:|---:|---:|
| Peak events | 14 | 41 | 32 |
| High + Peak events | 121 | 225 | 122 |
| Events that change level | – | 337 | 40 |

Novotel Rotterdam Brainpark:

| | Peak events | High + Peak shown |
|---|---|---:|
| Today | Bassie & Adriaan, Feyenoord–Como, –Inter, –Porto, C2C | 36 |
| B. Targeted | Breakbulk, ERA Congress 2027, InfraTech, Maintenance Next, CHIO, NN Marathon, WK Beachvolleybal | 35 |
| A. Full model | 10 Peak | 66 |

Named results, today → B:

- Breakbulk Europe: 71/High → 85/Peak
- Bassie & Adriaan: 85/Peak → 69/Medium
- Feyenoord and PSV Champions League matches: 88–93/Peak → 80/High
- C2C: 91/Peak → 84/High
- J. Cole at the Ziggo Dome: 90/Peak → 84/High
- Horecava: 84/High → 85/Peak
- IFFR, Europort and WK Turnen: unchanged (High)

Amsterdam hotels gain the most Peak days: ADE, IDFA, IBC, METSTRADE, Aquatech, DGTL, TCS Marathon. They move from 0–3 to 10–16 Peak events each.

## Why not option A

A nearly doubles the High/Peak list (121 → 225) and moves 337 events. Most of that rests on the coarse AI size guess:

- Every "35 points + business event" becomes High. The Novotel list would grow from 36 to 66 entries, the opposite of the "too many trivial events" complaint.
- Editions of the same series land on different levels depending on whether a number was found. DDW 2026 is Peak and DDW 2027 is High.
- Rooms-per-night is only as good as the visitor figure, and we have a measured figure for about 4% of events.

## Known weaknesses of B

- **A wrong number lifts the wrong event.** "Verknipt ADE Saturday" carries ADE's 500,000 total and rises from Medium to High. It is 1 of the 40 changes.
- **Next year's edition stays High until its own number is found.** DDW 2027 is High while DDW 2026 is Peak. The fix is to carry a comparable previous edition's figure forward; the evidence already records those historical facts.
- **Champions League becomes High for every hotel, including city-centre leisure hotels.** A per-hotel "business / leisure" setting is a separate decision.

## Implementation plan (B)

1. **`src/features/events/score.ts`**
   - Add the measured-visitor helper (attendance, quoted quantity, size-check visitors), the staying-share table and the rooms-per-night estimate as one exported function. Reuse `knownVenueCapacity` and `venueCrowdIsAudience`.
   - Apply the three rules after the existing proxy, before the stadium and size-check floors. Add a new `impactBasis` value, "hotel_rooms", so the change is traceable.
2. **`src/features/events/types.ts`:** add "hotel_rooms" to the `impactBasis` union. The database column is free text, and the export guard only rejects "default", so no migration is needed.
3. **Tests in `score.test.ts`, one per rule:**
   - an arena family show stays Medium;
   - an arena concert stops at High;
   - a measured international three-day trade fair reaches Peak;
   - a measured single-night concert does not reach Peak;
   - a CL match is High;
   - a measured event without a travelling audience is unchanged.
4. **Rescore stored scores** with the existing recalculation path. There are no provider calls and no running cost. Confirm with `scripts/rescore-preview.mjs` per hotel.
5. **Optional, recommended next:**
   - make the page reading fill the visitor number it quotes (Breakbulk's "12,800" was saved with an empty quantity); this is a prompt change with no extra calls;
   - carry a previous edition's figure forward.

   Both widen rule 2's reach without new cost.

Effort: about half a day to a day for steps 1–4, plus a day for step 5. No change in monthly AI cost.
