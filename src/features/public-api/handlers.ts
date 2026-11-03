import type { AdminClient } from "@/lib/supabase/admin";

import { availableUntil, loadApiEvents, loadApiHotels, parseEventsQuery, resolveHotel } from "./events";
import { authenticateApiKey, type ApiAccount } from "./keys";
import { apiError, apiJson, errorResponse, isApiError } from "./respond";

type Dependencies = { client: () => AdminClient; now?: () => Date };

/**
 * Every failure answers with an error status. A `200` with an empty list would make RevControl
 * delete all of the hotel's events, so an unexpected error must never look like an empty period.
 */
function createHandler(deps: Dependencies, respond: (client: AdminClient, account: ApiAccount, request: Request, now: Date) => Promise<Response>) {
  return async (request: Request) => {
    try {
      const client = deps.client();
      const now = deps.now?.() ?? new Date();
      const account = await authenticateApiKey(request.headers.get("authorization"), client, now);
      if (isApiError(account)) return errorResponse(account);
      return await respond(client, account, request, now);
    } catch (error) {
      console.error("Public API request failed", {
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : "unknown",
      });
      return errorResponse(apiError(500, "server_error", "DemandRadar could not complete this request. Try again later."));
    }
  };
}

export function createHotelsHandler(deps: Dependencies) {
  return createHandler(deps, async (client, account) => apiJson({ hotels: await loadApiHotels(client, account.accountId) }));
}

export function createEventsHandler(deps: Dependencies) {
  return createHandler(deps, async (client, account, request, now) => {
    const query = parseEventsQuery(new URL(request.url).searchParams);
    if (isApiError(query)) return errorResponse(query);
    const hotel = await resolveHotel(client, account.accountId, query.hotelId);
    if (isApiError(hotel)) return errorResponse(hotel);
    const events = await loadApiEvents(client, account, hotel.id, query, now);
    return apiJson({ hotel_id: hotel.id, from: query.from, to: query.to, available_until: availableUntil(account.trialEndsAt, now), events });
  });
}
