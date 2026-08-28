import { z } from "zod";

export const sourceName = z.enum([
  "rijksoverheid",
  "openholidays",
  "ticketmaster",
  "predicthq",
  "claude",
]);

export const hotelInput = z.object({
  id: z.preprocess((value) => value || undefined, z.uuid().optional()),
  name: z.string().trim().min(1, "Vul een hotelnaam in."),
  revcontrolCode: z.string().trim().min(1, "Vul de RevControl-code in."),
  address: z.string().trim().min(5, "Vul straat, huisnummer en plaats in.").regex(/\d/, "Vul ook een huisnummer in."),
  demandRadiusKm: z.coerce.number().positive().max(250),
  holidayRegion: z.preprocess(
    (value) => value || null,
    z.enum(["north", "middle", "south"]).nullable(),
  ),
  enabledSources: z.array(sourceName).min(1, "Kies minstens één bron."),
});

export type HotelInput = z.infer<typeof hotelInput>;

